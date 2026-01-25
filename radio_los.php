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

const EARTH_RADIUS_M = 6371008.8;

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

function clamp(float $value, float $min, float $max): float
{
    return max($min, min($max, $value));
}

function parsePoint(array $payload, string $key): ?array
{
    if (!isset($payload[$key]) || !is_array($payload[$key])) {
        return null;
    }
    $point = $payload[$key];

    $lat = $point['latitude'] ?? $point['lat'] ?? null;
    $lon = $point['longitude'] ?? $point['lon'] ?? null;
    $hagl = $point['height_agl_m'] ?? $point['height_agl'] ?? $point['height_above_local_elevation_m'] ?? $point['height'] ?? null;

    if (!isFiniteNumber($lat) || !isFiniteNumber($lon) || !isFiniteNumber($hagl)) {
        return null;
    }

    $latF = (float) $lat;
    $lonF = (float) $lon;
    $haglF = (float) $hagl;

    if ($latF < -90.0 || $latF > 90.0 || $lonF < -180.0 || $lonF > 180.0) {
        return null;
    }

    return [
        'latitude' => $latF,
        'longitude' => $lonF,
        'height_agl_m' => $haglF,
    ];
}

function haversineDistanceMeters(float $lat1Deg, float $lon1Deg, float $lat2Deg, float $lon2Deg): float
{
    $lat1 = deg2rad($lat1Deg);
    $lon1 = deg2rad($lon1Deg);
    $lat2 = deg2rad($lat2Deg);
    $lon2 = deg2rad($lon2Deg);

    $dLat = $lat2 - $lat1;
    $dLon = $lon2 - $lon1;

    $a = sin($dLat / 2.0) ** 2
        + cos($lat1) * cos($lat2) * (sin($dLon / 2.0) ** 2);
    $c = 2.0 * asin(min(1.0, sqrt($a)));
    return EARTH_RADIUS_M * $c;
}

function greatCircleInterpolate(float $lat1Deg, float $lon1Deg, float $lat2Deg, float $lon2Deg, float $fraction): array
{
    $lat1 = deg2rad($lat1Deg);
    $lon1 = deg2rad($lon1Deg);
    $lat2 = deg2rad($lat2Deg);
    $lon2 = deg2rad($lon2Deg);

    $sinLat1 = sin($lat1);
    $cosLat1 = cos($lat1);
    $sinLon1 = sin($lon1);
    $cosLon1 = cos($lon1);

    $sinLat2 = sin($lat2);
    $cosLat2 = cos($lat2);
    $sinLon2 = sin($lon2);
    $cosLon2 = cos($lon2);

    $x1 = $cosLat1 * $cosLon1;
    $y1 = $cosLat1 * $sinLon1;
    $z1 = $sinLat1;

    $x2 = $cosLat2 * $cosLon2;
    $y2 = $cosLat2 * $sinLon2;
    $z2 = $sinLat2;

    $dot = clamp($x1 * $x2 + $y1 * $y2 + $z1 * $z2, -1.0, 1.0);
    $delta = acos($dot);

    if ($delta < 1e-12) {
        return ['latitude' => $lat1Deg, 'longitude' => $lon1Deg];
    }

    $sinDelta = sin($delta);
    $a = sin((1.0 - $fraction) * $delta) / $sinDelta;
    $b = sin($fraction * $delta) / $sinDelta;

    $x = $a * $x1 + $b * $x2;
    $y = $a * $y1 + $b * $y2;
    $z = $a * $z1 + $b * $z2;

    $lat = atan2($z, sqrt(($x ** 2) + ($y ** 2)));
    $lon = atan2($y, $x);

    return [
        'latitude' => rad2deg($lat),
        'longitude' => rad2deg($lon),
    ];
}

function earthBulgeMeters(float $pathLengthM, float $distanceAlongM, float $kFactor): float
{
    if ($pathLengthM <= 0.0) {
        return 0.0;
    }
    $x = clamp($distanceAlongM, 0.0, $pathLengthM);
    $d = $pathLengthM;
    $re = EARTH_RADIUS_M * $kFactor;
    return ($x * ($d - $x)) / (2.0 * $re);
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

$point1 = parsePoint($payload, 'point1') ?? parsePoint($payload, 'a') ?? parsePoint($payload, 'from');
$point2 = parsePoint($payload, 'point2') ?? parsePoint($payload, 'b') ?? parsePoint($payload, 'to');

if ($point1 === null || $point2 === null) {
    http_response_code(400);
    echo json_encode([
        'error' => 'points_required',
        'expected' => [
            'point1' => ['latitude' => 'number', 'longitude' => 'number', 'height_agl_m' => 'number'],
            'point2' => ['latitude' => 'number', 'longitude' => 'number', 'height_agl_m' => 'number'],
        ],
    ]);
    exit;
}

$sampleDistanceM = 30.0;
if (isset($payload['sample_distance_m']) && isFiniteNumber($payload['sample_distance_m'])) {
    $sampleDistanceM = (float) $payload['sample_distance_m'];
}
$sampleDistanceM = clamp($sampleDistanceM, 5.0, 2000.0);

$maxSamples = 1000;
if (isset($payload['max_samples']) && isFiniteNumber($payload['max_samples'])) {
    $maxSamples = (int) $payload['max_samples'];
}
$maxSamples = max(3, min($maxSamples, 5000));

$includeProfile = isset($payload['include_profile']) && $payload['include_profile'] === true;

$includeCurvature = true;
if (isset($payload['include_curvature'])) {
    $includeCurvature = $payload['include_curvature'] === true;
}

$kFactor = 4.0 / 3.0;
if (isset($payload['k_factor'])) {
    if ($payload['k_factor'] === null) {
        $includeCurvature = false;
    } elseif (isFiniteNumber($payload['k_factor'])) {
        $kFactor = (float) $payload['k_factor'];
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'invalid_k_factor']);
        exit;
    }
}
if ($kFactor <= 0.0) {
    http_response_code(400);
    echo json_encode(['error' => 'invalid_k_factor']);
    exit;
}

$distanceM = haversineDistanceMeters(
    $point1['latitude'],
    $point1['longitude'],
    $point2['latitude'],
    $point2['longitude'],
);

$segments = (int) ceil($distanceM / $sampleDistanceM);
$segments = max(1, $segments);
$truncated = false;
if (($segments + 1) > $maxSamples) {
    $segments = $maxSamples - 1;
    $truncated = true;
}

$samplePoints = [];
for ($i = 0; $i <= $segments; $i++) {
    $fraction = $segments === 0 ? 0.0 : ($i / $segments);
    $pos = greatCircleInterpolate(
        $point1['latitude'],
        $point1['longitude'],
        $point2['latitude'],
        $point2['longitude'],
        $fraction,
    );
    $samplePoints[] = [
        'i' => $i,
        'latitude' => $pos['latitude'],
        'longitude' => $pos['longitude'],
    ];
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
        WITH input AS (
            SELECT *
            FROM json_to_recordset(:payload::json)
            AS t(i integer, latitude double precision, longitude double precision)
        ),
        points AS (
            SELECT
                i,
                ST_Transform(
                    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
                    CAST(:dem_srid AS integer)
                ) AS geom
            FROM input
        )
        SELECT
            p.i,
            ST_Value(r.$rastCol, 1, p.geom) AS elevation
        FROM points p
        LEFT JOIN LATERAL (
            SELECT $rastCol
            FROM $table
            WHERE ST_Intersects($rastCol, p.geom)
            LIMIT 1
        ) r ON true
        ORDER BY p.i
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':payload', json_encode($samplePoints, JSON_UNESCAPED_SLASHES), PDO::PARAM_STR);
    $stmt->bindValue(':dem_srid', $demSrid, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    $elevationByIndex = [];
    foreach ($rows as $row) {
        $idx = (int) $row['i'];
        $elevationByIndex[$idx] = $row['elevation'] !== null ? (float) $row['elevation'] : null;
    }

    $samples = [];
    $missing = [];
    for ($i = 0; $i <= $segments; $i++) {
        $fraction = $segments === 0 ? 0.0 : ($i / $segments);
        $distanceAlongM = $fraction * $distanceM;
        $elevation = $elevationByIndex[$i] ?? null;

        if ($elevation === null) {
            $missing[] = $i;
        }

        $samples[] = [
            'i' => $i,
            'fraction' => $fraction,
            'distance_m' => $distanceAlongM,
            'latitude' => $samplePoints[$i]['latitude'],
            'longitude' => $samplePoints[$i]['longitude'],
            'terrain_elevation_m' => $elevation,
        ];
    }

    if ($missing !== []) {
        http_response_code(422);
        echo json_encode([
            'error' => 'missing_dem_coverage',
            'distance_m' => $distanceM,
            'missing_sample_indices' => $missing,
            'sample_count' => count($samples),
        ], JSON_UNESCAPED_SLASHES);
        exit;
    }

    $ground1 = $samples[0]['terrain_elevation_m'];
    $ground2 = $samples[count($samples) - 1]['terrain_elevation_m'];
    if (!is_float($ground1) || !is_float($ground2)) {
        http_response_code(422);
        echo json_encode(['error' => 'missing_endpoint_elevation']);
        exit;
    }

    $txElevationM = $ground1 + $point1['height_agl_m'];
    $rxElevationM = $ground2 + $point2['height_agl_m'];

    $minClearanceM = INF;
    $worst = null;

    foreach ($samples as $s) {
        $lineHeightM = $txElevationM + ($rxElevationM - $txElevationM) * $s['fraction'];
        $bulgeM = ($includeCurvature && $kFactor > 0.0) ? earthBulgeMeters($distanceM, $s['distance_m'], $kFactor) : 0.0;
        $effectiveTerrainM = ((float) $s['terrain_elevation_m']) + $bulgeM;
        $clearanceM = $lineHeightM - $effectiveTerrainM;

        if ($clearanceM < $minClearanceM) {
            $minClearanceM = $clearanceM;
            $worst = [
                'i' => $s['i'],
                'fraction' => $s['fraction'],
                'distance_m' => $s['distance_m'],
                'latitude' => $s['latitude'],
                'longitude' => $s['longitude'],
                'terrain_elevation_m' => $s['terrain_elevation_m'],
                'earth_bulge_m' => $bulgeM,
                'line_height_m' => $lineHeightM,
                'clearance_m' => $clearanceM,
            ];
        }
    }

    $los = is_finite($minClearanceM) ? ($minClearanceM > 0.0) : null;

    $response = [
        'los' => $los,
        'distance_m' => $distanceM,
        'sample_distance_m' => $sampleDistanceM,
        'sample_count' => count($samples),
        'samples_truncated' => $truncated,
        'include_curvature' => $includeCurvature,
        'k_factor' => $includeCurvature ? $kFactor : null,
        'point1' => [
            'latitude' => $point1['latitude'],
            'longitude' => $point1['longitude'],
            'height_agl_m' => $point1['height_agl_m'],
            'ground_elevation_m' => $ground1,
            'antenna_elevation_m' => $txElevationM,
        ],
        'point2' => [
            'latitude' => $point2['latitude'],
            'longitude' => $point2['longitude'],
            'height_agl_m' => $point2['height_agl_m'],
            'ground_elevation_m' => $ground2,
            'antenna_elevation_m' => $rxElevationM,
        ],
        'min_clearance_m' => is_finite($minClearanceM) ? $minClearanceM : null,
        'worst_point' => $worst,
    ];

    if ($includeProfile) {
        $response['samples'] = $samples;
    }

    echo json_encode($response, JSON_UNESCAPED_SLASHES);
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
