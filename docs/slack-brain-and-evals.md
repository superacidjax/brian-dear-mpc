# Slack Brain And Human Eval Loop

The career brain now has a production-capable first implementation.

Local development stores data in `output/brain-store.json`. Production stores data in DynamoDB using the table configured by `BRAIN_TABLE_NAME`.

In production, Slack logs, human eval requests, mock interview prompts, and interview contact notifications are queued through SQS first. The App Runner process runs a lightweight worker loop when `ASYNC_WORKER_ENABLED=true`.

## Interview Collection

1. Brian sends `/brian-question`, sends `next question` to the Slack bot, or an admin calls `POST /api/brain/next-question`.
2. The configured model generates a fresh brain-building question and sends Brian a Slack DM.
3. Brian replies with an answer, or says `skip this`.
4. The system stores useful answers as approved `brain_fact` items.
5. The next question is sent only after Brian answers or skips the current one.
6. If Brian does not reply, nothing happens. The system stays ready for the eventual response.
7. Approved brain facts are injected into future model evidence bundles when relevant.

Mock-interview questions are not a fixed queue. They cover professional stories and non-restricted personal context such as hobbies, music, art, economics, books, travel, design taste, teaching, tools, craft, creative influences, and how Brian thinks. As Brian answers, the generator uses approved brain facts to ask deeper follow-ups rather than repeatedly starting from generic prompts. Static seed questions remain only as a fallback when the model provider is unavailable.

## Human Evaluation

1. Brian sends `/brian-eval`, sends `next eval` to the Slack bot, or an admin calls `POST /api/brain/next-eval`.
2. For answer-quality evals, the configured model generates a fresh interviewer-style question from Brian's target role families, recent eval history, and approved brain facts.
3. The system answers using the current career data plus relevant brain facts.
4. Slack sends Brian the question, answer, and rating buttons.
5. The rating is stored in `answer_evaluation` items.
6. The next eval is generated only after Brian rates the current one.

Answer-quality questions are not intended to be a fixed question bank. The model is prompted to act like interviewers for Staff Rails Engineer, Principal Product Engineer, AI Platform Engineer, AI Evaluation Lead, Product Engineering Lead, Director or VP Engineering, platform, startup, regulated systems, and adjacent roles. It rotates across technical depth, architecture, leadership, product judgment, executive communication, AI evaluation, delivery, risk, conflict, failure, and scaling. A static list remains only as a fallback if the model is unavailable.

For answer-quality evals, the rating is an audit trail for improving prompts and the private brain. When Brian rates an answer-quality eval `Good`, that generated question and answer are also saved as an approved `brain_fact`, so sample interview questions improve future answers. For job-fit evals, the model generates varied job descriptions across technical, non-technical, excellent-fit, partial-fit, low-fit, and misleading false-positive roles in many industries. The rating is also a scoring calibration signal. The system stores the original score, Brian's rating, a directional correction, and the source job description. Future job descriptions are compared with rated examples; similar roles are adjusted before the fit score is returned.

Examples:

- A false-positive teacher or retail role rated `Too high` lowers future scores for similar non-engineering roles.
- A strong engineering/platform role rated `Too low` raises future scores for similar roles.
- A strong engineering/platform role rated `Good` confirms that similar future scores should stay high.
- An `Incomplete` rating makes similar scores more conservative without treating the answer as wholly wrong.

## Slack App Requirements

The production version uses the Slack Web API through the bot token. Incoming webhooks are not required.

Required Slack capabilities:

- Bot token with DM permissions.
- Signing secret for interactive payload verification.
- Interactivity request URL: `https://www.briandear.ai/slack/actions`.
- Event subscription request URL: `https://www.briandear.ai/slack/events`.
- Slash command request URL: `https://www.briandear.ai/slack/commands`.
- A Brian Slack user ID so the bot knows whom to DM.

Required bot scopes:

- `chat:write`
- `channels:history`
- `channels:read`
- `im:history`
- `im:read`
- `im:write`
- `channels:manage` if you want the app to create or manage public channels itself

Required event subscription:

- `message.im`
- `message.channels`

Recommended slash commands:

- `/brian-question`
  - Request URL: `https://www.briandear.ai/slack/commands`
  - Short description: `Send Brian the next mock interview question`
  - Usage hint: `next`
  - Use this in the mock interview channel.
- `/brian-eval`
  - Request URL: `https://www.briandear.ai/slack/commands`
  - Short description: `Send Brian the next human evaluation item`
  - Usage hint: `[job|answer]`
  - Use this in the human eval channel.
  - `/brian-eval job` forces a job-fit scoring evaluation.
  - `/brian-eval answer` forces an answer-quality evaluation.
  - `/brian-eval` alternates between answer-quality and job-fit scoring evals.

Recommended public channels:

- `career-agent-user-log`: public site questions, answers, job scores, and contact handoffs.
- `career-agent-human-evals`: answer-quality evals and generated job-score evals with `Good`, `Bad`, `Incomplete`, `Too high`, and `Too low` buttons depending on eval type.
- `career-agent-mock-interview`: Brian's mock interview / brain-building questions with `Skip this` and `This is inappropriate` buttons.
- `career-agent-interview-requests`: recruiter contact and interview requests from the public chat.

Invite the Slack bot to each channel after creating them. Then configure:

```bash
SLACK_USER_LOG_CHANNEL_ID=C...
SLACK_HUMAN_EVAL_CHANNEL_ID=C...
SLACK_MOCK_INTERVIEW_CHANNEL_ID=C...
SLACK_INTERVIEW_REQUEST_CHANNEL_ID=C...
```

Recruiter contact notifications go to `SLACK_INTERVIEW_REQUEST_CHANNEL_ID` through the bot token. In production, those notifications are queued before delivery so the public chat can respond quickly.

## Admin Endpoints

When `ADMIN_TOKEN` is set, pass it as `x-admin-token`.

```bash
curl https://www.briandear.ai/api/brain/status -H "x-admin-token: $ADMIN_TOKEN"
curl -X POST https://www.briandear.ai/api/brain/next-question -H "x-admin-token: $ADMIN_TOKEN"
curl -X POST https://www.briandear.ai/api/brain/next-eval -H "x-admin-token: $ADMIN_TOKEN"
```
