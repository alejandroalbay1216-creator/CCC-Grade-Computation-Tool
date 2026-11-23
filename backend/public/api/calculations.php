<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth_helpers.php';
require_once __DIR__ . '/../../config/grade_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

authStartSession();
$user = authRequireUser();
if (!in_array($user['role'], ['admin', 'student'], true)) authRespond(403, ['error' => 'Student or administrator access is required.']);

try {
    $pdo = database();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($method === 'GET') {
        if ($user['role'] === 'admin') {
            $stmt = $pdo->query("SELECT c.id, u.student_name, u.login_id AS login_id, c.calculation_name, c.prelim_grade, c.midterm_grade, c.final_grade, c.computed_grade, c.equivalent_grade, c.remarks, c.activity_breakdown_json, c.created_at FROM grade_calculations c JOIN grade_users u ON u.id = c.user_id WHERE u.role = 'student' ORDER BY c.created_at DESC, c.id DESC");
            authRespond(200, ['data' => array_map('formatGradeRecord', $stmt->fetchAll())]);
        }
        $stmt = $pdo->prepare('SELECT id, calculation_name, prelim_grade, midterm_grade, final_grade, computed_grade, equivalent_grade, remarks, activity_breakdown_json, created_at FROM grade_calculations WHERE user_id = ? ORDER BY created_at DESC, id DESC');
        $stmt->execute([$user['id']]);
        authRespond(200, ['data' => array_map('formatGradeRecord', $stmt->fetchAll())]);
    }

    if ($user['role'] !== 'student') authRespond(403, ['error' => 'Only students can change their own calculations.']);

    if ($method === 'POST') {
        authRequireCsrf();
        $input = authReadJson();
        $name = trim((string)($input['calculation_name'] ?? ''));
        if ($name === '' || mb_strlen($name) > 100) {
            authRespond(422, ['error' => 'Enter a calculation name (maximum 100 characters).']);
        }
        try {
            $grades = calculateGradeValues($input);
        } catch (InvalidArgumentException $error) {
            authRespond(422, ['error' => $error->getMessage()]);
        }

        $breakdownJson = encodeActivityBreakdown($grades['activity_breakdown']);
        $stmt = $pdo->prepare('INSERT INTO grade_calculations (user_id, calculation_name, prelim_grade, midterm_grade, final_grade, computed_grade, equivalent_grade, remarks, activity_breakdown_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $stmt->execute([
            $user['id'],
            $name,
            $grades['prelim_grade'],
            $grades['midterm_grade'],
            $grades['final_grade'],
            $grades['computed_grade'],
            $grades['equivalent_grade'],
            $grades['remarks'],
            $breakdownJson
        ]);
        $id = (int)$pdo->lastInsertId();
        $record = $pdo->prepare('SELECT id, calculation_name, prelim_grade, midterm_grade, final_grade, computed_grade, equivalent_grade, remarks, activity_breakdown_json, created_at FROM grade_calculations WHERE id = ? AND user_id = ?');
        $record->execute([$id, $user['id']]);
        authRespond(201, ['message' => 'Your calculation was saved.', 'data' => formatGradeRecord($record->fetch())]);
    }

    if ($method === 'DELETE') {
        authRequireCsrf();
        $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
        if (!$id || $id < 1) authRespond(400, ['error' => 'A valid calculation ID is required.']);
        $stmt = $pdo->prepare('DELETE FROM grade_calculations WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $user['id']]);
        if ($stmt->rowCount() === 0) authRespond(404, ['error' => 'Calculation not found.']);
        authRespond(200, ['message' => 'Your calculation was deleted.']);
    }

    header('Allow: GET, POST, DELETE');
    authRespond(405, ['error' => 'Method not allowed.']);
} catch (PDOException $error) {
    error_log($error->getMessage());
    authRespond(500, ['error' => 'Database request failed. Check the PHP and MySQL configuration.']);
} catch (Throwable $error) {
    error_log($error->getMessage());
    authRespond(500, ['error' => 'Unexpected server error.']);
}
