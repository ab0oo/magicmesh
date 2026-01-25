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

$dbHost = requireEnv('MESH_DB_HOST');
$dbName = requireEnv('MESH_DB_NAME');
$dbUser = requireEnv('MESH_DB_USER');
$dbPass = requireEnv('MESH_DB_PASS');

$coordScale = 10000000.0;

$width = isset($_GET['width']) ? (float) $_GET['width'] : 0.0;
$height = isset($_GET['height']) ? (float) $_GET['height'] : 0.0;
$limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 50;
$limit = max(1, min($limit, 200));

if ($width <= 0 || $height <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'width and height are required']);
    exit;
}

try {
    $dsn = sprintf('pgsql:host=%s;dbname=%s', $dbHost, $dbName);
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    $bboxStmt = $pdo->prepare(
        'SELECT
            MIN(lat) AS min_lat,
            MAX(lat) AS max_lat,
            MIN(lon) AS min_lon,
            MAX(lon) AS max_lon
         FROM (
            SELECT
                CASE
                    WHEN geom IS NOT NULL THEN ST_Y(ST_Transform(geom, 4326))
                    ELSE latitude / :coord_scale
                END AS lat,
                CASE
                    WHEN geom IS NOT NULL THEN ST_X(ST_Transform(geom, 4326))
                    ELSE longitude / :coord_scale
                END AS lon
            FROM node_positions
            ORDER BY updated_at DESC
            LIMIT 200
         ) AS recent'
    );
    $bboxStmt->bindValue(':coord_scale', $coordScale, PDO::PARAM_STR);
    $bboxStmt->execute();
    $bbox = $bboxStmt->fetch();

    if (!$bbox || $bbox['min_lat'] === null) {
        echo json_encode(['nodes' => [], 'bbox' => null]);
        exit;
    }

    $minLat = (float) $bbox['min_lat'];
    $maxLat = (float) $bbox['max_lat'];
    $minLon = (float) $bbox['min_lon'];
    $maxLon = (float) $bbox['max_lon'];

    $nodesStmt = $pdo->prepare(
        'WITH recent AS (
            SELECT
                node_id,
                altitude,
                updated_at,
                CASE
                    WHEN geom IS NOT NULL THEN ST_Y(ST_Transform(geom, 4326))
                    ELSE latitude / :coord_scale
                END AS lat,
                CASE
                    WHEN geom IS NOT NULL THEN ST_X(ST_Transform(geom, 4326))
                    ELSE longitude / :coord_scale
                END AS lon
            FROM node_positions
        )
        SELECT node_id, lat, lon, altitude, updated_at
        FROM recent
        WHERE lat BETWEEN :min_lat AND :max_lat
          AND lon BETWEEN :min_lon AND :max_lon
        ORDER BY updated_at DESC
        LIMIT :limit'
    );
    $nodesStmt->bindValue(':coord_scale', $coordScale, PDO::PARAM_STR);
    $nodesStmt->bindValue(':min_lat', $minLat, PDO::PARAM_STR);
    $nodesStmt->bindValue(':max_lat', $maxLat, PDO::PARAM_STR);
    $nodesStmt->bindValue(':min_lon', $minLon, PDO::PARAM_STR);
    $nodesStmt->bindValue(':max_lon', $maxLon, PDO::PARAM_STR);
    $nodesStmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $nodesStmt->execute();
    $rows = $nodesStmt->fetchAll();

    $latSpan = max($maxLat - $minLat, 1e-9);
    $lonSpan = max($maxLon - $minLon, 1e-9);

    $nodes = [];
    foreach ($rows as $row) {
        $lat = (float) $row['lat'];
        $lon = (float) $row['lon'];
        $x = ($lon - $minLon) / $lonSpan * $width;
        $y = ($maxLat - $lat) / $latSpan * $height;

        $nodes[] = [
            'node_id' => (int) $row['node_id'],
            'latitude' => $lat,
            'longitude' => $lon,
            'altitude' => $row['altitude'] !== null ? (float) $row['altitude'] : null,
            'updated_at' => $row['updated_at'],
            'x' => $x,
            'y' => $y,
        ];
    }

    echo json_encode([
        'nodes' => $nodes,
        'bbox' => [
            'min_lat' => $minLat,
            'max_lat' => $maxLat,
            'min_lon' => $minLon,
            'max_lon' => $maxLon,
        ],
    ]);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode(['error' => 'server_error']);
}
