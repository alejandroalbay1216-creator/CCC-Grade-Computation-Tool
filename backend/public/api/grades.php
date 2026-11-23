<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth_helpers.php';
require_once __DIR__ . '/../../config/grade_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function gradeData(array $input): array
{
    $name = trim((string)($input['student_name'] ?? ''));
    $studentId = trim((string)($input['student_id'] ?? ''));
    if ($name === '' || mb_strlen($name) > 150 || $studentId === '' || mb_strlen($studentId) > 50) {
        respond(422, ['error' => 'Student name (max 150 characters) and student ID (max 50 characters) are required.']);
    }

    try {
        $grades = calculateGradeValues($input);
    } catch (InvalidArgumentException $error) {
        respond(422, ['error' => $error->getMessage()]);
    }
    $activityBreakdown = $grades['activity_breakdown'];
    unset($grades['activity_breakdown']);
    return array_merge(
        ['student_name' => $name, 'student_id' => $studentId],
        $grades,
        ['activity_breakdown_json' => encodeActivityBreakdown($activityBreakdown)]
    );
}

try {
    authStartSession();
    $user = authRequireUser();
    $pdo = database();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);

    if (isset($_GET['id']) && (!$id || $id < 1)) respond(400, ['error' => 'A valid record ID is required.']);

    if ($method === 'GET') {
        if ($user['role'] === 'student') {
            if ($id) {
                $stmt = $pdo->prepare('SELECT * FROM grade_records WHERE id = ? AND student_id = ?');
                $stmt->execute([$id, $user['student_id']]);
                $record = $stmt->fetch();
                if (!$record) respond(404, ['error' => 'Grade record not found.']);
                respond(200, ['data' => formatGradeRecord($record)]);
            }
            $stmt = $pdo->prepare('SELECT * FROM grade_records WHERE student_id = ? ORDER BY updated_at DESC, id DESC');
            $stmt->execute([$user['student_id']]);
            respond(200, ['data' => array_map('formatGradeRecord', $stmt->fetchAll())]);
        }

        if ($id) {
            $stmt = $pdo->prepare('SELECT * FROM grade_records WHERE id = ?');
            $stmt->execute([$id]);
            $record = $stmt->fetch();
            if (!$record) respond(404, ['error' => 'Grade record not found.']);
            respond(200, ['data' => formatGradeRecord($record)]);
        }
        $records = $pdo->query('SELECT * FROM grade_records ORDER BY updated_at DESC, id DESC')->fetchAll();
        respond(200, ['data' => array_map('formatGradeRecord', $records)]);
    }

    if (!in_array($method, ['POST', 'PUT', 'DELETE'], true)) {
        header('Allow: GET, POST, PUT, DELETE');
        respond(405, ['error' => 'Method not allowed.']);
    }
    if ($user['role'] !== 'admin') respond(403, ['error' => 'Administrator access is required.']);
    authRequireCsrf();

    if ($method === 'POST' || $method === 'PUT') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!is_array($input)) respond(400, ['error' => 'Request body must be valid JSON.']);
        $data = gradeData($input);

        if ($method === 'POST') {
            $stmt = $pdo->prepare('INSERT INTO grade_records (student_name,student_id,prelim_grade,midterm_grade,final_grade,computed_grade,equivalent_grade,remarks,activity_breakdown_json) VALUES (:student_name,:student_id,:prelim_grade,:midterm_grade,:final_grade,:computed_grade,:equivalent_grade,:remarks,:activity_breakdown_json)');
            $stmt->execute($data);
            $data['id'] = (int)$pdo->lastInsertId();
            respond(201, ['message' => 'Grade record saved.', 'data' => formatGradeRecord($data)]);
        }

        if (!$id) respond(400, ['error' => 'A valid record ID is required for updates.']);
        $pdo->beginTransaction();
        try {
            $current = $pdo->prepare('SELECT student_id, student_name, activity_breakdown_json FROM grade_records WHERE id = ? FOR UPDATE');
            $current->execute([$id]);
            $currentRecord = $current->fetch();
            if (!$currentRecord) {
                $pdo->rollBack();
                respond(404, ['error' => 'Grade record not found.']);
            }
            if (!array_key_exists('activity_breakdown', $input)) {
                $data['activity_breakdown_json'] = $currentRecord['activity_breakdown_json'];
            }
            $stmt = $pdo->prepare('UPDATE grade_records SET student_name=:student_name,student_id=:student_id,prelim_grade=:prelim_grade,midterm_grade=:midterm_grade,final_grade=:final_grade,computed_grade=:computed_grade,equivalent_grade=:equivalent_grade,remarks=:remarks,activity_breakdown_json=:activity_breakdown_json WHERE id=:id');
            $stmt->execute(array_merge($data, ['id' => $id]));
            if ($currentRecord['student_id'] !== $data['student_id'] || $currentRecord['student_name'] !== $data['student_name']) {
                $syncStudent = $pdo->prepare("UPDATE grade_users SET student_id = ?, student_name = ?, session_version = session_version + 1 WHERE role = 'student' AND student_id = ?");
                $syncStudent->execute([$data['student_id'], $data['student_name'], $currentRecord['student_id']]);
                $syncProfile = $pdo->prepare("UPDATE grade_user_profiles p JOIN grade_users u ON u.id = p.user_id SET p.student_id = ? WHERE u.role = 'student' AND u.student_id = ?");
                $syncProfile->execute([$data['student_id'], $data['student_id']]);
            }
            $pdo->commit();
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
        respond(200, ['message' => 'Grade record updated.', 'data' => formatGradeRecord(array_merge(['id' => $id], $data))]);
    }

    if (!$id) respond(400, ['error' => 'A valid record ID is required for deletion.']);
    $pdo->beginTransaction();
    try {
        $current = $pdo->prepare('SELECT student_id FROM grade_records WHERE id = ? FOR UPDATE');
        $current->execute([$id]);
        $studentId = $current->fetchColumn();
        if ($studentId === false) {
            $pdo->rollBack();
            respond(404, ['error' => 'Grade record not found.']);
        }
        $removeAccount = $pdo->prepare("DELETE FROM grade_users WHERE role = 'student' AND student_id = ?");
        $removeAccount->execute([$studentId]);
        $stmt = $pdo->prepare('DELETE FROM grade_records WHERE id = ?');
        $stmt->execute([$id]);
        $pdo->commit();
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $error;
    }
    respond(200, ['message' => 'Grade record deleted.']);
} catch (PDOException $error) {
    error_log($error->getMessage());
    if ((string)$error->getCode() === '23000') respond(409, ['error' => 'A grade record with this student ID already exists.']);
    respond(500, ['error' => 'Database request failed. Check the PHP and MySQL configuration.']);
} catch (Throwable $error) {
    error_log($error->getMessage());
    respond(500, ['error' => 'Unexpected server error.']);
}
