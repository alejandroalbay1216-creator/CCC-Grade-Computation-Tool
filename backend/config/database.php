<?php
declare(strict_types=1);
function database(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) return $pdo;
    $host = getenv('DB_HOST');
    $port = getenv('DB_PORT');
    $name = getenv('DB_NAME');
    $user = getenv('DB_USER');
    $password = getenv('DB_PASSWORD');
    if (getenv('APP_ENV') === 'production') {
        foreach (['DB_HOST' => $host, 'DB_PORT' => $port, 'DB_NAME' => $name, 'DB_USER' => $user, 'DB_PASSWORD' => $password] as $setting => $value) {
            if ($value === false || $value === '') {
                throw new RuntimeException($setting . ' must be configured in production.');
            }
        }
    }
    $host = $host ?: '127.0.0.1';
    $port = $port ?: '3307';
    $name = $name ?: 'college_grading_system';
    $user = $user ?: 'root';
    $password = $password ?: '';
    $pdo = new PDO("mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4", $user, $password, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
    return $pdo;
}
