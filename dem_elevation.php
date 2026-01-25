<?php
declare(strict_types=1);

header('Content-Type: application/json');

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

// DEM table settings (update to match your database).
$demTable = requireEnv('GIS_DEM_TABLE');
$demRasterColumn = requireEnv('GIS_DEM_RASTER_COLUMN');
$demSridRaw = requireEnv('GIS_DEM_SRID');
$demSrid = (int) $demSridRaw;
if ($demSrid <= 0) {
    http_response_code(500);
    echo json_encode(['error' => 'invalid_env', 'var' => 'GIS_DEM_SRID']);
    exit;
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

$nodes = $payload['nodes'] ?? $payload;
if (!is_array($nodes) || $nodes === []) {
    http_response_code(400);
    echo json_encode(['error' => 'nodes_required']);
    exit;
}

$cleanNodes = [];
foreach ($nodes as $node) {
    if (!is_array($node)) {
        continue;
    }
    if (!isset($node['node_id'], $node['latitude'], $node['longitude'])) {
        continue;
    }
    $cleanNodes[] = [
        'node_id' => (int) $node['node_id'],
        'latitude' => (float) $node['latitude'],
        'longitude' => (float) $node['longitude'],
    ];
}

if ($cleanNodes === []) {
    http_response_code(400);
    echo json_encode(['error' => 'nodes_required']);
    exit;
}

$table = preg_replace('/[^a-zA-Z0-9_]/', '', $demTable);
$rastCol = preg_replace('/[^a-zA-Z0-9_]/', '', $demRasterColumn);

$debug = isset($_GET['debug']) && $_GET['debug'] === '1';
// TODO: remove debug mode in production.

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
            AS t(node_id bigint, latitude double precision, longitude double precision)
        ),
        points AS (
            SELECT
                node_id,
                ST_Transform(
                    ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
                    CAST(:dem_srid AS integer)
                ) AS geom
            FROM input
        )
        SELECT
            p.node_id,
            ST_Value(r.$rastCol, 1, p.geom) AS elevation
        FROM points p
        LEFT JOIN LATERAL (
            SELECT $rastCol
            FROM $table
            WHERE ST_Intersects($rastCol, p.geom)
            LIMIT 1
        ) r ON true
        ORDER BY p.node_id
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':payload', json_encode($cleanNodes), PDO::PARAM_STR);
    $stmt->bindValue(':dem_srid', $demSrid, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();

    echo json_encode(['nodes' => $rows]);
} catch (Throwable $error) {
    http_response_code(500);
    if ($debug) {
        echo json_encode([
            'error' => 'server_error',
            'message' => $error->getMessage(),
        ]);
        exit;
    }
    echo json_encode(['error' => 'server_error']);
}
