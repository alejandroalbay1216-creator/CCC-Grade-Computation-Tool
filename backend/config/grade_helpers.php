<?php
declare(strict_types=1);

function calculateGradeValues(array $input): array
{
    $grades = [];
    $breakdown = null;
    if (array_key_exists('activity_breakdown', $input)) {
        if (!is_array($input['activity_breakdown'])) {
            throw new InvalidArgumentException('Enter valid term grades or activity scores.');
        }

        $terms = [
            'prelim' => ['field' => 'prelim_grade', 'label' => 'Prelim'],
            'midterm' => ['field' => 'midterm_grade', 'label' => 'Midterm'],
            'final' => ['field' => 'final_grade', 'label' => 'Final']
        ];
        $categories = [
            'auxiliary' => ['label' => 'Auxiliary', 'weight' => .20],
            'minor_activity' => ['label' => 'Minor Activity', 'weight' => .40],
            'major_activity' => ['label' => 'Major Activity', 'weight' => .40]
        ];
        $normalizedBreakdown = [];
        $hasActivityScores = false;
        foreach ($terms as $termKey => $term) {
            $termBreakdown = $input['activity_breakdown'][$termKey] ?? null;
            if ($termBreakdown === null || $termBreakdown === []) {
                $directGrade = $input[$term['field']] ?? null;
                if (!is_numeric($directGrade) || (float)$directGrade < 0 || (float)$directGrade > 100) {
                    throw new InvalidArgumentException($term['label'] . ' grade must be a number from 0 to 100.');
                }
                $grades[$term['field']] = round((float)$directGrade, 2);
                $normalizedBreakdown[$termKey] = null;
                continue;
            }
            if (!is_array($termBreakdown)) {
                throw new InvalidArgumentException('Enter valid term grades or activity scores.');
            }
            $hasActivityScores = true;
            $termScore = 0;
            foreach ($categories as $categoryKey => $category) {
                $scores = $termBreakdown[$categoryKey] ?? null;
                if (!is_array($scores) || count($scores) === 0) {
                    throw new InvalidArgumentException($term['label'] . ' requires at least one ' . $category['label'] . ' score.');
                }
                $normalizedScores = [];
                $scoreTotal = 0;
                foreach ($scores as $score) {
                    if (!is_numeric($score) || (float)$score < 0 || (float)$score > 100) {
                        throw new InvalidArgumentException('Each activity score must be a number from 0 to 100.');
                    }
                    $normalizedScore = round((float)$score, 2);
                    $normalizedScores[] = $normalizedScore;
                    $scoreTotal += $normalizedScore;
                }
                $categoryAverage = round($scoreTotal / count($normalizedScores), 2);
                $termScore += $categoryAverage * $category['weight'];
                $normalizedBreakdown[$termKey][$categoryKey] = $normalizedScores;
            }
            $grades[$term['field']] = round($termScore, 2);
        }
        if ($hasActivityScores) $breakdown = $normalizedBreakdown;
    } else {
        foreach (['prelim_grade', 'midterm_grade', 'final_grade'] as $field) {
            if (!isset($input[$field]) || !is_numeric($input[$field]) || (float)$input[$field] < 0 || (float)$input[$field] > 100) {
                throw new InvalidArgumentException('Each grade must be a number from 0 to 100.');
            }
            $grades[$field] = round((float)$input[$field], 2);
        }
    }

    $computed = round($grades['prelim_grade'] * .30 + $grades['midterm_grade'] * .30 + $grades['final_grade'] * .40, 2);
    $equivalent = '5.00';
    foreach ([[96, '1.00'], [92, '1.25'], [88, '1.50'], [84, '1.75'], [80, '2.00'], [75, '2.25'], [70, '2.50'], [65, '2.75'], [60, '3.00'], [55, '4.00']] as [$min, $value]) {
        if ($computed >= $min) {
            $equivalent = $value;
            break;
        }
    }

    return array_merge($grades, [
        'computed_grade' => $computed,
        'equivalent_grade' => $equivalent,
        'remarks' => $computed >= 60 ? 'PASSED' : 'FAILED',
        'activity_breakdown' => $breakdown
    ]);
}

function encodeActivityBreakdown($breakdown): ?string
{
    if ($breakdown === null) return null;
    $json = json_encode($breakdown, JSON_UNESCAPED_UNICODE);
    if ($json === false) throw new RuntimeException('Unable to encode activity breakdown.');
    return $json;
}

function formatGradeRecord(array $record): array
{
    $json = $record['activity_breakdown_json'] ?? null;
    unset($record['activity_breakdown_json']);
    if ($json === null || $json === '') {
        $record['activity_breakdown'] = null;
        return $record;
    }

    $breakdown = json_decode((string)$json, true);
    if (!is_array($breakdown) || json_last_error() !== JSON_ERROR_NONE) {
        throw new UnexpectedValueException('Stored activity breakdown is invalid.');
    }
    $record['activity_breakdown'] = $breakdown;
    return $record;
}
