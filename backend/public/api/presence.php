<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
authStartSession();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    authRespond(405, ['error' => 'Method not allowed.']);
}

$user = authRequireUser();
if ($user['role'] !== 'student') authRespond(403, ['error' => 'Only student accounts can update student presence.']);
authRequireCsrf();

try {
    $stmt = database()->prepare("UPDATE grade_users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ? AND role = 'student'");
    $stmt->execute([$user['id']]);
    authRespond(200, ['status' => 'Online']);
} catch (PDOException $error) {
    error_log($error->getMessage());
    authRespond(500, ['error' => 'Unable to update online status.']);
}
