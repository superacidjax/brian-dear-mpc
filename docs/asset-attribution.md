# Asset Attribution

The public site keeps technology logos in `public/assets/logos-v2/`.

Use official vendor artwork where available and keep each file lightweight:

- AWS service icons: AWS Architecture Icons for App Runner, CloudFront, CloudFormation, DynamoDB, ECR, Route 53, SQS, Secrets Manager, WAF, and Amazon Bedrock.
- TypeScript: official TypeScript project logo.
- Node.js: Node.js project logo.
- Express: Express project mark.
- Slack: Slack brand mark.
- Ollama: Ollama project mark.
- MCP: project-local mark for Model Context Protocol usage.
- PDF generation: project-local text badge, not a third-party logo.

When updating logos:

- Prefer official SVG assets from the vendor or project.
- Keep raster assets only when an official SVG is not available.
- Preserve meaningful `alt` text in `public/index.html`.
- Do not add tracking pixels, remote image URLs, or unoptimized decorative assets.
