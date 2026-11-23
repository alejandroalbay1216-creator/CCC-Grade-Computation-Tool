<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
authStartSession();
$admin = authRequireAdmin();

try {
    $pdo = database();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        $sql = "SELECT su.student_user_id AS user_id, u.login_id AS username, p.first_name, p.middle_name, p.last_name, COALESCE(u.student_id, p.student_id, u.login_id) AS student_id, p.year_level, p.department, u.created_at,
                    CASE WHEN u.last_activity_at >= (NOW() - INTERVAL 30 SECOND) THEN 'Online' ELSE 'Offline' END AS account_status
                FROM grade_users u
                INNER JOIN grade_student_user_ids su ON su.user_id = u.id
                LEFT JOIN grade_user_profiles p ON p.user_id = u.id
                WHERE u.role = 'student'
                ORDER BY u.created_at DESC, u.id DESC";
        authRespond(200, ['data' => $pdo->query($sql)->fetchAll()]);
    }

    if ($method !== 'POST') {
        header('Allow: GET, POST');
        authRespond(405, ['error' => 'Method not allowed.']);
    }

    authRequireCsrf();
    $input = authReadJson();
    $studentId = trim((string)($input['student_id'] ?? ''));
    if ($studentId === '' || mb_strlen($studentId) > 50) authRespond(422, ['error' => 'Enter a valid student ID.']);

    $grade = $pdo->prepare('SELECT student_name FROM grade_records WHERE student_id = ? LIMIT 1');
    $grade->execute([$studentId]);
    $studentName = $grade->fetchColumn();
    if ($studentName === false) authRespond(404, ['error' => 'Save an official grade record before enabling linked access.']);

    $expiresAt = date('Y-m-d H:i:s', time() + 86400);
    $approval = $pdo->prepare('INSERT INTO grade_registration_approvals (student_id, expires_at, approved_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at), approved_by = VALUES(approved_by), approved_at = CURRENT_TIMESTAMP');
    $approval->execute([$studentId, $expiresAt, $admin['id']]);
    authRespond(201, [
        'message' => 'Official grade access enabled for 24 hours. Verify the student in person before linking the account.',
        'data' => ['student_id' => $studentId, 'student_name' => $studentName, 'expires_at' => $expiresAt]
    ]);
} catch (PDOException $error) {
    error_log($error->getMessage());
    authRespond(500, ['error' => 'Database request failed. Check the PHP and MySQL configuration.']);
} catch (Throwable $error) {
    error_log($error->getMessage());
    authRespond(500, ['error' => 'Unexpected server error.']);
}
