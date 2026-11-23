<?php
declare(strict_types=1);

require_once __DIR__ . '/database.php';

final class DatabaseSessionHandler implements SessionHandlerInterface, SessionUpdateTimestampHandlerInterface
{
    private $locks = [];

    public function open($savePath, $sessionName)
    {
        return true;
    }

    public function close()
    {
        if (!$this->locks) return true;

        $success = true;
        try {
            $statement = database()->prepare('SELECT RELEASE_LOCK(?)');
            foreach (array_keys($this->locks) as $lockName) {
                $statement->execute([$lockName]);
                if ((int)$statement->fetchColumn() !== 1) {
                    error_log('Unable to release a database-backed session lock.');
                    $success = false;
                }
            }
        } catch (Throwable $error) {
            error_log('Unable to release database-backed session locks: ' . $error->getMessage());
            $success = false;
        }

        $this->locks = [];
        return $success;
    }

    public function read($sessionId)
    {
        $this->acquireLock($sessionId);
        $statement = database()->prepare('SELECT session_data FROM grade_sessions WHERE session_id = ? AND expires_at > ?');
        $statement->execute([$sessionId, time()]);
        $data = $statement->fetchColumn();
        return $data === false ? '' : (string)$data;
    }

    public function write($sessionId, $sessionData)
    {
        $this->acquireLock($sessionId);
        $expiresAt = time() + max(1, (int)ini_get('session.gc_maxlifetime'));
        $statement = database()->prepare(
            'INSERT INTO grade_sessions (session_id, session_data, expires_at) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE session_data = VALUES(session_data), expires_at = VALUES(expires_at)'
        );
        $statement->bindValue(1, $sessionId, PDO::PARAM_STR);
        $statement->bindValue(2, $sessionData, PDO::PARAM_LOB);
        $statement->bindValue(3, $expiresAt, PDO::PARAM_INT);
        return $statement->execute();
    }

    public function destroy($sessionId)
    {
        $statement = database()->prepare('DELETE FROM grade_sessions WHERE session_id = ?');
        return $statement->execute([$sessionId]);
    }

    public function gc($maxLifetime)
    {
        $statement = database()->prepare('DELETE FROM grade_sessions WHERE expires_at <= ?');
        $statement->execute([time()]);
        return $statement->rowCount();
    }

    public function validateId($sessionId)
    {
        $this->acquireLock($sessionId);
        $statement = database()->prepare('SELECT 1 FROM grade_sessions WHERE session_id = ? AND expires_at > ?');
        $statement->execute([$sessionId, time()]);
        return $statement->fetchColumn() !== false;
    }

    public function updateTimestamp($sessionId, $sessionData)
    {
        $this->acquireLock($sessionId);
        $expiresAt = time() + max(1, (int)ini_get('session.gc_maxlifetime'));
        $statement = database()->prepare('UPDATE grade_sessions SET expires_at = ? WHERE session_id = ? AND expires_at > ?');
        return $statement->execute([$expiresAt, $sessionId, time()]);
    }

    private function acquireLock($sessionId)
    {
        $lockName = 'ccc_grade_s_' . substr(hash('sha256', $sessionId), 0, 48);
        if (isset($this->locks[$lockName])) return;

        $statement = database()->prepare('SELECT GET_LOCK(?, 10)');
        $statement->execute([$lockName]);
        if ((int)$statement->fetchColumn() !== 1) {
            throw new RuntimeException('Unable to acquire the database-backed session lock.');
        }
        $this->locks[$lockName] = true;
    }
}
