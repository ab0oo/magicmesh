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

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    exit;
}

$width = isset($_GET['width']) ? (float) $_GET['width'] : 0.0;
$height = isset($_GET['height']) ? (float) $_GET['height'] : 0.0;
$limit = isset($_GET['limit']) ? (int) $_GET['limit'] : 100;

$limit = max(1, min($limit, 200));
if ($width <= 0 || $height <= 0) {
    http_response_code(400);
    echo json_encode(['error' => 'width and height are required']);
    exit;
}

$remoteUrl = requireEnv('NODE_POSITIONS_REMOTE_URL');
$query = http_build_query([
    'width' => $width,
    'height' => $height,
    'limit' => $limit,
]);

$context = stream_context_create([
    'http' => [
        'method' => 'GET',
        'timeout' => 8,
        'header' => "Accept: application/json\r\n",
    ],
]);

$response = @file_get_contents($remoteUrl . '?' . $query, false, $context);
if ($response === false) {
    http_response_code(502);
    echo json_encode(['error' => 'upstream_unavailable']);
    exit;
}

echo $response;
