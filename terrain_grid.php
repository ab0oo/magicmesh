<?php
declare(strict_types=1);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'method_not_allowed']);
    exit;
}

function requireEnv(string $key): string
{
    $value = getenv($key);
    if (!is_string($value) || trim($value) === '') {
        http_response_code(500);
        echo json_encode(['error' => 'missing_env', 'var' => $key]);
        exit;
    }
    return $value;
}

function isFiniteNumber(mixed $value): bool
{
    if (!is_int($value) && !is_float($value) && !is_string($value)) {
        return false;
    }
    if (is_string($value) && trim($value) === '') {
        return false;
    }
    $number = (float) $value;
    return is_finite($number);
}

$raw = file_get_contents('php://input');
if ($raw === false || trim($raw) === '') {
    http_response_code(400);
    echo json_encode(['error' => 'missing_json_body']);
    exit;
}

$payload = json_decode($raw, true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_json']);
    exit;
}

$bbox = $payload['bbox'] ?? null;
if (!is_array($bbox)) {
    http_response_code(400);
    echo json_encode(['error' => 'bbox_required']);
    exit;
}

$minLat = $bbox['min_lat'] ?? null;
$maxLat = $bbox['max_lat'] ?? null;
$minLon = $bbox['min_lon'] ?? null;
$maxLon = $bbox['max_lon'] ?? null;

if (!isFiniteNumber($minLat) || !isFiniteNumber($maxLat) || !isFiniteNumber($minLon) || !isFiniteNumber($maxLon)) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_bbox']);
    exit;
}

$minLat = (float) $minLat;
$maxLat = (float) $maxLat;
$minLon = (float) $minLon;
$maxLon = (float) $maxLon;

if ($minLat < -90.0 || $maxLat > 90.0 || $minLon < -180.0 || $maxLon > 180.0 || $minLat >= $maxLat || $minLon >= $maxLon) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_bbox']);
    exit;
}

$width = $payload['width'] ?? null;
$height = $payload['height'] ?? null;
if (!isFiniteNumber($width) || !isFiniteNumber($height)) {
    http_response_code(400);
    echo json_encode(['error' => 'width_height_required']);
    exit;
}

$width = (int) $width;
$height = (int) $height;
if ($width < 16 || $height < 16 || $width > 512 || $height > 512) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_grid_size']);
    exit;
}

$pointCount = $width * $height;
if ($pointCount > 120000) {
    http_response_code(400);
    echo json_encode(['error' => 'grid_too_large']);
    exit;
}

$dbHost = requireEnv('GIS_DB_HOST');
$dbName = requireEnv('GIS_DB_NAME');
$dbUser = requireEnv('GIS_DB_USER');
$dbPass = requireEnv('GIS_DB_PASS');

$demTable = requireEnv('GIS_DEM_TABLE');
$demRasterColumn = requireEnv('GIS_DEM_RASTER_COLUMN');
$demSridRaw = requireEnv('GIS_DEM_SRID');
$demSrid = (int) $demSridRaw;
if ($demSrid <= 0) {
    http_response_code(500);
    echo json_encode(['error' => 'invalid_env', 'var' => 'GIS_DEM_SRID']);
    exit;
}

$table = preg_replace('/[^a-zA-Z0-9_]/', '', $demTable);
$rastCol = preg_replace('/[^a-zA-Z0-9_]/', '', $demRasterColumn);
$debug = isset($_GET['debug']) && $_GET['debug'] === '1';

try {
    $dsn = sprintf('pgsql:host=%s;dbname=%s', $dbHost, $dbName);
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $sql = "
        WITH params AS (
            SELECT
                CAST(:min_lat AS double precision) AS min_lat,
                CAST(:max_lat AS double precision) AS max_lat,
                CAST(:min_lon AS double precision) AS min_lon,
                CAST(:max_lon AS double precision) AS max_lon,
                CAST(:w AS integer) AS w,
                CAST(:h AS integer) AS h,
                CAST(:dem_srid AS integer) AS dem_srid
        ),
        envelope AS (
            SELECT
                ST_Transform(
                    ST_SetSRID(
                        ST_MakeEnvelope(p.min_lon, p.min_lat, p.max_lon, p.max_lat),
                        4326
                    ),
                    p.dem_srid
                ) AS geom
            FROM params p
        ),
        target AS (
            SELECT
                ST_MakeEmptyRaster(
                    p.w,
                    p.h,
                    ST_XMin(e.geom),
                    ST_YMax(e.geom),
                    (ST_XMax(e.geom) - ST_XMin(e.geom)) / p.w,
                    -1 * (ST_YMax(e.geom) - ST_YMin(e.geom)) / p.h,
                    0,
                    0,
                    p.dem_srid
                ) AS rast
            FROM params p
            CROSS JOIN envelope e
        ),
        clipped AS (
            SELECT
                ST_Resample(ST_Clip(d.$rastCol, e.geom), t.rast) AS rast
            FROM $table d
            CROSS JOIN envelope e
            CROSS JOIN target t
            WHERE ST_Intersects(d.$rastCol, e.geom)
        ),
        mosaic AS (
            SELECT
                ST_Union(c.rast) AS rast
            FROM clipped c
        ),
        grid AS (
            SELECT
                x,
                y
            FROM generate_series(1, (SELECT w FROM params)) AS x
            CROSS JOIN generate_series(1, (SELECT h FROM params)) AS y
        )
        SELECT
            (g.x - 1) AS x,
            (g.y - 1) AS y,
            ST_Value(m.rast, 1, g.x, g.y, true) AS elevation
        FROM grid g
        CROSS JOIN mosaic m
        ORDER BY g.y, g.x
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':min_lat', $minLat, PDO::PARAM_STR);
    $stmt->bindValue(':max_lat', $maxLat, PDO::PARAM_STR);
    $stmt->bindValue(':min_lon', $minLon, PDO::PARAM_STR);
    $stmt->bindValue(':max_lon', $maxLon, PDO::PARAM_STR);
    $stmt->bindValue(':w', $width, PDO::PARAM_INT);
    $stmt->bindValue(':h', $height, PDO::PARAM_INT);
    $stmt->bindValue(':dem_srid', $demSrid, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $grid = [];
    $minElevation = null;
    $maxElevation = null;
    $missing = 0;
    foreach ($rows as $row) {
        $elevation = $row['elevation'] !== null ? (float) $row['elevation'] : null;
        if ($elevation !== null && ($elevation < -10000.0 || $elevation > 10000.0)) {
            $elevation = null;
        }
        if ($elevation === null) {
            $missing += 1;
            $grid[] = null;
            continue;
        }
        $grid[] = $elevation;
        $minElevation = $minElevation === null ? $elevation : min($minElevation, $elevation);
        $maxElevation = $maxElevation === null ? $elevation : max($maxElevation, $elevation);
    }

    if (count($grid) !== $pointCount) {
        http_response_code(500);
        echo json_encode(['error' => 'unexpected_result_size']);
        exit;
    }

    if ($missing === $pointCount) {
        http_response_code(422);
        echo json_encode([
            'error' => 'no_dem_coverage',
            'bbox' => [
                'min_lat' => $minLat,
                'max_lat' => $maxLat,
                'min_lon' => $minLon,
                'max_lon' => $maxLon,
            ],
            'width' => $width,
            'height' => $height,
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    echo json_encode([
        'bbox' => [
            'min_lat' => $minLat,
            'max_lat' => $maxLat,
            'min_lon' => $minLon,
            'max_lon' => $maxLon,
        ],
        'width' => $width,
        'height' => $height,
        'min_elevation_m' => $minElevation,
        'max_elevation_m' => $maxElevation,
        'missing_samples' => $missing,
        'grid' => $grid,
    ], JSON_UNESCAPED_SLASHES);
} catch (Throwable $error) {
    http_response_code(500);
    if ($debug) {
        echo json_encode([
            'error' => 'server_error',
            'message' => $error->getMessage(),
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }
    echo json_encode(['error' => 'server_error'], JSON_UNESCAPED_SLASHES);
}
