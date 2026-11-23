<?php
declare(strict_types=1);
require_once __DIR__ . '/../../config/database.php';
require_once __DIR__ . '/../../config/auth_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
authStartSession();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $user = authCurrentUser();
    if ($user && !authSessionIsValid($user)) {
        authExpireSession();
        $user = null;
    }
    authRespond(200, [
        'authenticated' => (bool)$user,
        'user' => $user ? authPublicUser($user) : null,
        'csrf_token' => authCsrfToken()
    ]);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: GET, POST');
    authRespond(405, ['error' => 'Method not allowed.']);
}

$input = authReadJson();
authRequireCsrf();
$action = (string)($input['action'] ?? '');

try {
    if ($action === 'register') {
        $username = trim((string)($input['username'] ?? ''));
        $studentId = trim((string)($input['student_id'] ?? ''));
        $firstName = trim((string)($input['first_name'] ?? ''));
        $middleName = trim((string)($input['middle_name'] ?? ''));
        $lastName = trim((string)($input['last_name'] ?? ''));
        $yearLevel = trim((string)($input['year_level'] ?? ''));
        $department = trim((string)($input['department'] ?? ''));
        $validYearLevels = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
        $validDepartments = ['Teacher Education', 'Arts and Sciences', 'Business and Accounting', 'Computing and Informatics'];
        $studentName = implode(' ', array_filter([$firstName, $middleName, $lastName], function ($part) {
            return $part !== '';
        }));
        $password = (string)($input['password'] ?? '');
        if (preg_match('/\p{N}/u', $firstName) !== 0
            || preg_match('/\p{N}/u', $middleName) !== 0
            || preg_match('/\p{N}/u', $lastName) !== 0) {
            authRespond(422, ['error' => 'First, middle, and last names cannot contain numbers.']);
        }
        if (preg_match('/\A[0-9]+\z/', $studentId) !== 1) {
            authRespond(422, ['error' => 'Student ID must contain numbers only.']);
        }
        if ($username === '' || mb_strlen($username) > 50
            || $firstName === '' || mb_strlen($firstName) > 60 || mb_strlen($middleName) > 60 || $lastName === '' || mb_strlen($lastName) > 60
            || $studentId === '' || mb_strlen($studentId) > 50 || mb_strlen($studentName) > 150
            || !in_array($yearLevel, $validYearLevels, true) || !in_array($department, $validDepartments, true)) {
            authRespond(422, ['error' => 'Enter a username, valid first and last names, student ID, year level, and department. Middle name is optional.']);
        }
        if (strlen($password) < 8 || strlen($password) > 72) {
            authRespond(422, ['error' => 'Password must be between 8 and 72 characters.']);
        }

        $pdo = database();
        $pdo->beginTransaction();
        try {
            $gradeQuery = $pdo->prepare('SELECT student_name FROM grade_records WHERE student_id = ? FOR UPDATE');
            $gradeQuery->execute([$studentId]);
            $gradeName = $gradeQuery->fetchColumn();
            $approvalQuery = $pdo->prepare('SELECT expires_at FROM grade_registration_approvals WHERE student_id = ? FOR UPDATE');
            $approvalQuery->execute([$studentId]);
            $approval = $approvalQuery->fetch();
            $approvalValid = $approval && strtotime($approval['expires_at']) > time();
            $nameMatches = $gradeName !== false
                && mb_strtolower($studentName) === mb_strtolower(trim((string)$gradeName));
            $linkOfficialRecord = $approvalValid && $nameMatches;

            $accountQuery = $pdo->prepare("SELECT id, login_id, student_id, session_version
                FROM grade_users
                WHERE role = 'student' AND (student_id = ? OR login_id = ?)
                FOR UPDATE");
            $accountQuery->execute([$studentId, $studentId]);
            $accounts = $accountQuery->fetchAll();
            $profileAccountQuery = $pdo->prepare("SELECT u.id, u.login_id, u.student_id, u.session_version
                FROM grade_user_profiles p
                JOIN grade_users u ON u.id = p.user_id
                WHERE u.role = 'student' AND p.student_id = ?
                FOR UPDATE");
            $profileAccountQuery->execute([$studentId]);
            foreach ($profileAccountQuery->fetchAll() as $profileAccount) {
                $alreadyFound = false;
                foreach ($accounts as $account) {
                    if ((int)$account['id'] === (int)$profileAccount['id']) {
                        $alreadyFound = true;
                        break;
                    }
                }
                if (!$alreadyFound) $accounts[] = $profileAccount;
            }
            if (count($accounts) > 1) {
                $pdo->rollBack();
                authRespond(409, ['error' => 'This Student ID is associated with more than one account. Contact the administrator.']);
            }
            $account = $accounts[0] ?? false;
            $usernameQuery = $pdo->prepare("SELECT id FROM grade_users WHERE role = 'student' AND login_id = ? FOR UPDATE");
            $usernameQuery->execute([$username]);
            $usernameAccountId = $usernameQuery->fetchColumn();
            if ($usernameAccountId !== false && (!$account || (int)$usernameAccountId !== (int)$account['id'])) {
                $pdo->rollBack();
                authRespond(409, ['error' => 'That username is already in use. Choose another username.']);
            }
            $passwordHash = password_hash($password, PASSWORD_DEFAULT);
            if ($linkOfficialRecord) {
                if ($account && $account['student_id'] !== null && $account['student_id'] !== $studentId) {
                    $pdo->rollBack();
                    authRespond(409, ['error' => 'This Student ID is already linked to another account. Contact the administrator.']);
                }
                if ($account) {
                    $newVersion = (int)$account['session_version'] + 1;
                    $update = $pdo->prepare("UPDATE grade_users SET login_id = ?, student_id = ?, student_name = ?, password_hash = ?, session_version = ? WHERE id = ?");
                    $update->execute([$username, $studentId, $gradeName, $passwordHash, $newVersion, $account['id']]);
                    $accountId = (int)$account['id'];
                } else {
                    $insert = $pdo->prepare("INSERT INTO grade_users (login_id, role, student_id, student_name, password_hash) VALUES (?, 'student', ?, ?, ?)");
                    $insert->execute([$username, $studentId, $gradeName, $passwordHash]);
                    $accountId = (int)$pdo->lastInsertId();
                }
                $consumeApproval = $pdo->prepare('DELETE FROM grade_registration_approvals WHERE student_id = ?');
                $consumeApproval->execute([$studentId]);
            } else {
                if ($account) {
                    $pdo->rollBack();
                    authRespond(409, ['error' => 'An account already uses this Student ID. Sign in with its username or contact the administrator to link it to an official grade record.']);
                }
                $insert = $pdo->prepare("INSERT INTO grade_users (login_id, role, student_id, student_name, password_hash) VALUES (?, 'student', NULL, ?, ?)");
                $insert->execute([$username, $studentName, $passwordHash]);
                $accountId = (int)$pdo->lastInsertId();
            }
            $profile = $pdo->prepare('INSERT INTO grade_user_profiles (user_id, student_id, first_name, middle_name, last_name, year_level, department) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE student_id = VALUES(student_id), first_name = VALUES(first_name), middle_name = VALUES(middle_name), last_name = VALUES(last_name), year_level = VALUES(year_level), department = VALUES(department)');
            $profile->execute([$accountId, $studentId, $firstName, $middleName === '' ? null : $middleName, $lastName, $yearLevel, $department]);
            $studentUserIdQuery = $pdo->prepare('SELECT student_user_id FROM grade_student_user_ids WHERE user_id = ? FOR UPDATE');
            $studentUserIdQuery->execute([$accountId]);
            if ($studentUserIdQuery->fetchColumn() === false) {
                $createStudentUserId = $pdo->prepare('INSERT INTO grade_student_user_ids (user_id) VALUES (?)');
                $createStudentUserId->execute([$accountId]);
            }
            $pdo->commit();

            authRespond(201, ['message' => 'Account created successfully. Sign in with your username and password.']);
        } catch (Throwable $error) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $error;
        }
    }

    if ($action === 'login') {
        $role = (string)($input['role'] ?? '');
        if ($role !== 'admin' && $role !== 'student') authRespond(422, ['error' => 'Choose a valid account type.']);

        $pdo = database();
        if ($role === 'admin') {
            $adminPin = (string)($input['admin_pin'] ?? '');
            if ($adminPin === '') authRespond(422, ['error' => 'Enter your Admin PIN.']);

            $stmt = $pdo->query("SELECT id, login_id, role, student_id, student_name, password_hash, session_version FROM grade_users WHERE role = 'admin' ORDER BY id");
            $account = false;
            while ($candidate = $stmt->fetch()) {
                if (password_verify($adminPin, $candidate['password_hash'])) {
                    $account = $candidate;
                    break;
                }
            }
            if (!$account) authRespond(401, ['error' => 'The Admin PIN is incorrect.']);
        } else {
            $username = trim((string)($input['username'] ?? ''));
            $password = (string)($input['password'] ?? '');
            if ($username === '' || $password === '') authRespond(422, ['error' => 'Enter your username and password.']);

            $stmt = $pdo->prepare("SELECT id, login_id, role, student_id, student_name, password_hash, session_version FROM grade_users WHERE role = 'student' AND login_id = ? LIMIT 1");
            $stmt->execute([$username]);
            $account = $stmt->fetch();
            if (!$account || !password_verify($password, $account['password_hash'])) {
                authRespond(401, ['error' => 'The username or password is incorrect.']);
            }
            $presence = $pdo->prepare("UPDATE grade_users SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ? AND role = 'student'");
            $presence->execute([$account['id']]);
        }

        session_regenerate_id(true);
        authSetSessionCookie();
        $_SESSION['user'] = [
            'id' => (int)$account['id'],
            'login_id' => $account['login_id'],
            'role' => $account['role'],
            'student_id' => $account['student_id'],
            'student_name' => $account['student_name'],
            'session_version' => (int)$account['session_version']
        ];
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        authRespond(200, ['message' => 'Signed in.', 'user' => authPublicUser($_SESSION['user']), 'csrf_token' => $_SESSION['csrf_token']]);
    }

    $user = authRequireUser();
    if ($action === 'logout') {
        authRequireCsrf();
        if ($user['role'] === 'student') {
            $presence = database()->prepare("UPDATE grade_users SET last_activity_at = NULL WHERE id = ? AND role = 'student'");
            $presence->execute([$user['id']]);
        }
        $_SESSION = [];
        session_destroy();
        $secure = authRequestIsSecure();
        setcookie(session_name(), '', time() - 3600, '/', '', $secure, true);
        authRespond(200, ['message' => 'Signed out.']);
    }

    if ($action === 'change_password') {
        authRequireCsrf();
        $currentPassword = (string)($input['current_password'] ?? '');
        $newPassword = (string)($input['new_password'] ?? '');
        $minimumLength = $user['role'] === 'admin' ? 16 : 8;
        if (strlen($newPassword) < $minimumLength || strlen($newPassword) > 72) {
            $credentialName = $user['role'] === 'admin' ? 'Admin PIN' : 'Password';
            authRespond(422, ['error' => $credentialName . ' must be between ' . $minimumLength . ' and 72 characters.']);
        }
        $pdo = database();
        $stmt = $pdo->prepare('SELECT password_hash FROM grade_users WHERE id = ?');
        $stmt->execute([$user['id']]);
        $hash = $stmt->fetchColumn();
        if (!$hash || !password_verify($currentPassword, $hash)) authRespond(401, ['error' => 'Current password is incorrect.']);

        $update = $pdo->prepare('UPDATE grade_users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?');
        $update->execute([password_hash($newPassword, PASSWORD_DEFAULT), $user['id']]);
        $_SESSION['user']['session_version']++;
        session_regenerate_id(true);
        authSetSessionCookie();
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        authRespond(200, ['message' => 'Password changed.', 'csrf_token' => $_SESSION['csrf_token']]);
    }

    authRespond(400, ['error' => 'Unknown authentication action.']);
} catch (PDOException $error) {
    error_log($error->getMessage());
    if ((string)$error->getCode() === '23000' && $action === 'register') {
        authRespond(409, ['error' => 'The username or Student ID is already in use.']);
    }
    authRespond(500, ['error' => 'Authentication service is unavailable. Check the database configuration.']);
} catch (Throwable $error) {
    error_log($error->getMessage());
    authRespond(500, ['error' => 'Unexpected authentication error.']);
}
