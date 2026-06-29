# Brain Datastore Schema

Production stores the career brain in DynamoDB. Local development stores the same document shapes in `output/brain-store.json`.

## DynamoDB Table

Table name:

```text
brian-dear-career-mcp-brain-prod
```

Primary key:

- `id` string hash key

Global secondary index:

- `entityType-createdAt-index`
- Partition key: `entityType`
- Sort key: `createdAt`

The index lets the application query each entity type without scanning the full table.

## Entity Types

### `interview_question`

```json
{
  "id": "interview_uuid",
  "entityType": "interview_question",
  "question": "What is Brian's best example of leading through ambiguity?",
  "topic": "team_leadership",
  "status": "pending | asked | answered | skipped",
  "slackTs": "optional Slack message timestamp",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "answeredAt": "optional ISO timestamp"
}
```

### `brain_fact`

```json
{
  "id": "fact_uuid",
  "entityType": "brain_fact",
  "topic": "team_leadership",
  "question": "Original prompt",
  "answer": "Brian's approved answer",
  "language": "en",
  "source": "brian_slack_interview | brian_human_eval_approved_answer",
  "status": "approved",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

`brian_slack_interview` facts come from Brian answering mock interview questions directly. `brian_human_eval_approved_answer` facts come from Brian rating an answer-quality sample eval as `Good`.

### `answer_evaluation`

```json
{
  "id": "eval_uuid",
  "entityType": "answer_evaluation",
  "evalKind": "answer | job_score",
  "generatedQuestion": "Question or job title",
  "generatedAnswer": "Generated answer or score explanation",
  "jobDescription": "optional job description",
  "fitScore": 82,
  "fitLabel": "Great Fit | Good Fit | Low Fit",
  "status": "awaiting_rating | rated",
  "rating": "good | bad | incomplete | too_high | too_low",
  "calibrationSignal": "confirmed | too_high | too_low | incomplete",
  "scoreAdjustment": -24,
  "calibrationReason": "Brian marked this job-fit score bad; similar future scores should be lower.",
  "slackTs": "optional Slack message timestamp",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "ratedAt": "optional ISO timestamp"
}
```

For `job_score` evaluations, ratings are active calibration data:

- `good` confirms the score and stores a zero adjustment.
- `too_high` lowers similar future scores.
- `too_low` raises similar future scores.
- Older `bad` ratings are interpreted with role context for backward compatibility.
- `incomplete` makes similar future scores more cautious.

The job-fit scorer loads rated `job_score` items, compares incoming job descriptions with those examples, applies a weighted score adjustment, and returns learning metadata with the response. Local development persists this in JSON; production persists it in DynamoDB.

## Future Upgrade Path

PostgreSQL with pgvector is the likely next datastore when the brain needs semantic retrieval, richer audit trails, and answer-quality analytics. DynamoDB is the right first production store because the current workload is small, structured, cheap, and easy to operate. True model fine-tuning can be added later after enough high-quality eval examples exist; the current production loop uses deterministic calibration so each Brian rating has an immediate effect.
