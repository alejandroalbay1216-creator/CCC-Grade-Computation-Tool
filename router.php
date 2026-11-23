<?php
declare(strict_types=1);

// Small development router: serve frontend files, expose only required APIs,
// and keep backend configuration and SQL files outside the web surface.
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (strpos($path, '/backend/') === 0) {
    $apiRoutes = [
        '/backend/public/api/grades.php' => __DIR__ . '/backend/public/api/grades.php',
        '/backend/public/api/auth.php' => __DIR__ . '/backend/public/api/auth.php',
        '/backend/public/api/accounts.php' => __DIR__ . '/backend/public/api/accounts.php',
        '/backend/public/api/presence.php' => __DIR__ . '/backend/public/api/presence.php',
        '/backend/public/api/calculations.php' => __DIR__ . '/backend/public/api/calculations.php'
    ];
    if (isset($apiRoutes[$path])) {
        require $apiRoutes[$path];
        return true;
    }
    http_response_code(404);
    echo 'Not found';
    return true;
}
if ($path === '/') {
    header('Location: /frontend/');
    return true;
}
$file = realpath(__DIR__ . $path);
$frontend = realpath(__DIR__ . '/frontend');
if ($file && $frontend && strpos($file, $frontend . DIRECTORY_SEPARATOR) === 0 && is_file($file)) {
    return false;
}
http_response_code(404);
echo 'Not found';
return true;
