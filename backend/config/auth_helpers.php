<?php
declare(strict_types=1);

function authStartSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('CCC_GRADE_SESSION');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    session_set_cookie_params(0, '/', '', $secure, true);
    session_start();
    authSetSessionCookie();
}

function authSetSessionCookie(): void
{
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    $cookie = session_name() . '=' . rawurlencode(session_id()) . '; Path=/; HttpOnly; SameSite=Lax';
    if ($secure) $cookie .= '; Secure';
    header('Set-Cookie: ' . $cookie, true);
}

function authRespond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function authReadJson(): array
{
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) authRespond(400, ['error' => 'Request body must be valid JSON.']);
    return $input;
}

function authCsrfToken(): string
{
    if (empty($_SESSION['csrf_token'])) $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf_token'];
}

function authRequireCsrf(): void
{
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!isset($_SESSION['csrf_token']) || !is_string($provided) || !hash_equals($_SESSION['csrf_token'], $provided)) {
        authRespond(403, ['error' => 'Your session expired. Refresh the page and try again.']);
    }
}

function authCurrentUser(): ?array
{
    return isset($_SESSION['user']) && is_array($_SESSION['user']) ? $_SESSION['user'] : null;
}

function authSessionIsValid(array $user): bool
{
    try {
        $stmt = database()->prepare('SELECT role, student_id, session_version FROM grade_users WHERE id = ?');
        $stmt->execute([$user['id']]);
        $account = $stmt->fetch();
    } catch (Throwable $error) {
        error_log($error->getMessage());
        authRespond(500, ['error' => 'Authentication service is unavailable.']);
    }

    return $account
        && $account['role'] === $user['role']
        && (int)$account['session_version'] === (int)$user['session_version']
        && $account['student_id'] === $user['student_id'];
}

function authExpireSession(): void
{
    $_SESSION = [];
    session_regenerate_id(true);
    authSetSessionCookie();
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

function authRequireUser(): array
{
    $user = authCurrentUser();
    if (!$user) authRespond(401, ['error' => 'Please sign in to continue.']);
    if (!authSessionIsValid($user)) {
        authExpireSession();
        authRespond(401, ['error' => 'Your session is no longer valid. Please sign in again.']);
    }
    return $user;
}

function authRequireAdmin(): array
{
    $user = authRequireUser();
    if (($user['role'] ?? '') !== 'admin') authRespond(403, ['error' => 'Administrator access is required.']);
    return $user;
}

function authPublicUser(array $user): array
{
    return [
        'id' => (int)$user['id'],
        'login_id' => $user['role'] === 'admin' ? 'Administrator' : $user['login_id'],
        'role' => $user['role'],
        'student_id' => $user['student_id'],
        'student_name' => $user['student_name'],
        'display_name' => $user['role'] === 'student' ? $user['student_name'] : 'Administrator'
    ];
}
