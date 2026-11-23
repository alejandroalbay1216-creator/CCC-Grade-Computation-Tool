<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../config/database.php';

try {
    $pdo = database();
    $adminCount = (int)$pdo->query("SELECT COUNT(*) FROM grade_users WHERE role = 'admin'")->fetchColumn();
    if ($adminCount > 0) {
        fwrite(STDERR, "An administrator account already exists.\n");
        exit(1);
    }

    $adminPin = (string)readline('Choose Admin PIN (at least 16 characters): ');
    if (strlen($adminPin) < 16 || strlen($adminPin) > 72) {
        fwrite(STDERR, "Admin PIN must be between 16 and 72 characters.\n");
        exit(1);
    }
    $confirmation = (string)readline('Confirm Admin PIN: ');
    if (!hash_equals($adminPin, $confirmation)) {
        fwrite(STDERR, "The Admin PIN entries do not match.\n");
        exit(1);
    }

    $stmt = $pdo->prepare("INSERT INTO grade_users (login_id, role, password_hash) VALUES ('administrator', 'admin', ?)");
    $stmt->execute([password_hash($adminPin, PASSWORD_DEFAULT)]);

    fwrite(STDOUT, "Admin account created.\n");
    fwrite(STDOUT, "Admin PIN saved as a password hash. Use the PIN you entered to sign in.\n");
} catch (Throwable $error) {
    error_log($error->getMessage());
    fwrite(STDERR, "Unable to create the admin account. Confirm the database schema is imported.\n");
    exit(1);
}
