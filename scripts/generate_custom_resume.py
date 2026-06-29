#!/usr/bin/env python3
import json
import re
import sys
from html import escape
from io import BytesIO
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph
from reportlab.pdfgen import canvas


PAGE_W, PAGE_H = letter
LEFT = 0.62 * inch
RIGHT = PAGE_W - LEFT
TOP = PAGE_H - 0.48 * inch
BOTTOM = 0.52 * inch
INK = colors.HexColor("#2f3437")
MUTED = colors.HexColor("#5c6471")
BLUE = colors.HexColor("#1f4f78")
PURPLE = colors.HexColor("#6f568e")
GREEN = colors.HexColor("#587d65")
LINE = colors.HexColor("#d6dde5")
PALE = colors.HexColor("#f6f8fb")


THEME_RULES = {
    "rails": {
        "terms": ["ruby", "rails", "postgres", "backend", "api", "monolith", "legacy", "modernization"],
        "summary": "Deep Ruby on Rails experience across greenfield products, legacy modernization, internal APIs, async services, regulated systems, and high-scale internal tools.",
        "capability": "Ruby on Rails, PostgreSQL, REST/GraphQL APIs, monolith modernization, async services, test strategy"
    },
    "ai_platform": {
        "terms": ["ai", "ml", "llm", "rag", "ai eval", "model evaluation", "human evaluation", "model", "agentic", "mcp", "retrieval"],
        "summary": "Practical AI platform experience building Rails software around AI/ML human evaluation, scoring workflows, RAG documentation search, and internal tooling.",
        "capability": "AI/ML human evaluation, RAG, LLM integration, model-quality workflows, internal AI tools, MCP servers"
    },
    "platform": {
        "terms": ["platform", "developer productivity", "ci/cd", "devops", "infrastructure", "kubernetes", "release", "build"],
        "summary": "Platform background includes Apple developer productivity, source-control modernization, CI/CD orchestration, distributed builds, Kubernetes, and a 90% build-time reduction.",
        "capability": "AWS, Kubernetes, Docker, CI/CD, release engineering, distributed builds, observability, incident response"
    },
    "leadership": {
        "terms": ["lead", "staff", "principal", "manager", "director", "vp", "head", "mentor", "executive", "stakeholder"],
        "summary": "Leadership experience includes managing engineers, mentoring, hiring, senior stakeholder alignment, roadmap delivery, and hands-on technical direction.",
        "capability": "Engineering leadership, mentoring, hiring, roadmap delivery, stakeholder alignment, architecture reviews"
    },
    "product": {
        "terms": ["product", "customer", "user", "ux", "workflow", "requirements", "roadmap", "analytics", "b2b", "b2c"],
        "summary": "Strong product engineering instincts from founder-led work, internal tools, regulated workflows, customer development, and data-heavy UX.",
        "capability": "Product engineering, requirements discovery, workflow design, B2B/B2C products, analytics-informed delivery"
    },
    "regulated": {
        "terms": ["regulated", "compliance", "fintech", "insurance", "government", "audit", "benefits", "financial", "privacy"],
        "summary": "Experienced in regulated environments spanning government benefits, fintech, insurance, privacy-sensitive mental health, and enterprise consulting.",
        "capability": "Compliance-aware engineering, audit-friendly workflows, government benefits, fintech operations, privacy-sensitive systems"
    },
    "startup": {
        "terms": ["startup", "founder", "seed", "series", "0 to 1", "customer development", "early stage"],
        "summary": "Founder-shaped operator who built iCouch from concept to working platform and helped Take the Interview scale from seed stage through Series B.",
        "capability": "0-to-1 product development, founder mindset, customer development, remote teams, startup execution"
    },
    "teaching": {
        "terms": ["teach", "teacher", "classroom", "student", "education", "curriculum", "lesson", "professor", "learning"],
        "summary": "Teaching and communication experience includes adjunct economics and management instruction plus years of mentoring engineers and translating complex systems.",
        "capability": "Teaching, mentoring, communication, economics and management instruction, onboarding, documentation"
    },
}

THEME_LABELS = {
    "ai_platform": "AI Platform",
    "rails": "Rails",
    "platform": "Platform",
    "leadership": "Leadership",
    "product": "Product",
    "regulated": "Regulated Systems",
    "startup": "Startup",
    "teaching": "Teaching",
}

ROLE_PATTERNS = [
    (r"\b(vp|vice president|head of engineering)\b", "VP Engineering"),
    (r"\bdirector\b", "Director of Engineering"),
    (r"\bstaff\b.*\bengineer\b", "Staff Engineer"),
    (r"\bprincipal\b.*\bengineer\b", "Principal Engineer"),
    (r"\bteacher\b|\bteaching\b|\beducation\b", "Education and Technical Leadership"),
    (r"\bai\b|\bllm\b|\brag\b|\bmodel evaluation\b|\bai eval", "AI Platform Engineer"),
    (r"\bplatform\b", "Platform Engineering Lead"),
    (r"\brails\b|\bruby\b", "Senior Rails Engineer"),
    (r"\bproduct\b", "Product Engineering Lead"),
]


def load_input():
    payload = json.loads(sys.stdin.read() or "{}")
    career_path = Path(payload["careerDataPath"])
    with career_path.open() as f:
        data = json.load(f)
    return payload.get("jobDescription", ""), data


def words(text):
    return set(re.findall(r"[a-z0-9+#.]{3,}", text.lower()))


def count_terms(text, terms):
    haystack = text.lower()
    return sum(1 for term in terms if term in haystack)


def theme_scores(job_description):
    return {
        theme: count_terms(job_description, rule["terms"])
        for theme, rule in THEME_RULES.items()
    }


def selected_themes(job_description):
    scores = theme_scores(job_description)
    ranked = [theme for theme, score in sorted(scores.items(), key=lambda item: item[1], reverse=True) if score > 0]
    if ranked:
        return ranked[:4]
    return ["rails", "product", "leadership"]


def infer_role(job_description):
    first_lines = " ".join(line.strip() for line in job_description.splitlines()[:6] if line.strip())
    scope = first_lines or job_description
    for pattern, label in ROLE_PATTERNS:
        if re.search(pattern, scope, re.I):
            return label
    return "Targeted Engineering Leadership"


def score_text(text, jd_words, themes):
    text_words = words(text)
    score = len(text_words & jd_words)
    lowered = text.lower()
    for theme in themes:
        score += 3 * count_terms(lowered, THEME_RULES[theme]["terms"])
    return score


def targeted_summary(data, job_description, themes):
    role = infer_role(job_description)
    sentences = [f"Senior product, platform, Rails, and AI engineering leader targeted for {role} roles."]
    for theme in themes:
        sentences.append(THEME_RULES[theme]["summary"])
    if "leadership" not in themes:
        sentences.append("Comfortable moving between hands-on implementation, architecture, stakeholder translation, and team leadership.")
    if "regulated" not in themes and "startup" not in themes:
        sentences.append("Career spans Apple, government benefits, fintech, healthcare, enterprise consulting, and startup product work.")
    return " ".join(sentences[:5])


def capability_rows(data, themes, job_description):
    rows = [(THEME_LABELS.get(theme, theme.replace("_", " ").title()), THEME_RULES[theme]["capability"]) for theme in themes]
    rows.append(("Languages", rank_list(data["skills"]["languages_and_frameworks"], job_description, 8)))
    rows.append(("Data / AI", rank_list(data["skills"]["data_and_ai"], job_description, 10)))
    rows.append(("Cloud / Ops", rank_list(data["skills"]["platform_and_ops"], job_description, 10)))
    rows.append(("Leadership", rank_list(data["skills"]["leadership_and_product"], job_description, 8)))
    seen = set()
    unique = []
    for label, value in rows:
        if label in seen:
            continue
        seen.add(label)
        unique.append((label, value if isinstance(value, str) else ", ".join(value)))
    return unique[:7]


def rank_list(items, job_description, limit):
    jd_words = words(job_description)
    ranked = sorted(items, key=lambda item: (score_text(item, jd_words, selected_themes(job_description)), -len(item)), reverse=True)
    return ranked[:limit]


def project_evidence(data, job_description, themes):
    jd_words = words(job_description)
    candidates = []
    for project in data.get("projects", []):
        contribution = project.get("contributions", [""])[0]
        text = f"{project['name']}: {project['summary']} {contribution} {project.get('impact', '')}"
        content = " ".join(project.get("themes", [])) + " " + text
        candidates.append((score_text(content, jd_words, themes), text))
    for job in data.get("experience", []):
        highlights = " ".join(job.get("highlights", [])[:2])
        text = f"{job['company']}: {job['title']}. {highlights}"
        content = f"{job['company']} {job['title']} {highlights}"
        candidates.append((score_text(content, jd_words, themes), text))
    ranked = sorted(candidates, key=lambda item: item[0], reverse=True)
    return [text for _, text in ranked[:4]]


def job_score(job, job_description, themes, index):
    content = " ".join([job["company"], job["title"], " ".join(job.get("highlights", []))])
    score = score_text(content, words(job_description), themes)
    if index == 0:
        score += 8
    if any(term in job["title"].lower() for term in ["professor", "teacher"]) and "teaching" in themes:
        score += 20
    return score


def selected_jobs(data, job_description, themes):
    jobs = data["experience"]
    ranked_indexes = sorted(range(len(jobs)), key=lambda idx: job_score(jobs[idx], job_description, themes, idx), reverse=True)
    selected = {0}
    for idx in ranked_indexes:
        selected.add(idx)
        if len(selected) >= 8:
            break
    return sorted((jobs[idx] for idx in selected), key=job_sort_key, reverse=True)


def job_sort_key(job):
    match = re.search(r"(20\d{2}|19\d{2})", job.get("start", ""))
    start_year = int(match.group(1)) if match else 0
    current = 1 if job.get("end", "").lower() in {"present", "current"} else 0
    return (current, start_year)


def selected_bullets(job, job_description, themes):
    highlights = job.get("highlights", [])
    ranked = sorted(highlights, key=lambda item: score_text(item, words(job_description), themes), reverse=True)
    count = 4 if ranked and score_text(ranked[0], words(job_description), themes) >= 5 else 3
    if len(highlights) <= 2:
        count = len(highlights)
    return ranked[:count]


def xml(text):
    return escape(text, quote=False)


def clean_line(text):
    return re.sub(r"\s+", " ", text).strip().replace("–", "-").replace("—", "-")


def draw_paragraph(c, text, x, y, width, style):
    para = Paragraph(text, style)
    _, h = para.wrap(width, 1000)
    para.drawOn(c, x, y - h)
    return y - h


def add_footer(c, page_num):
    c.setFont("Helvetica", 8.6)
    c.setFillColor(MUTED)
    c.drawString(LEFT, 0.31 * inch, "Brian Dear | Customized resume")
    c.drawRightString(RIGHT, 0.31 * inch, str(page_num))


class ResumeDoc:
    def __init__(self, data, job_description):
        self.data = data
        self.job_description = job_description
        self.themes = selected_themes(job_description)
        self.buffer = BytesIO()
        self.c = canvas.Canvas(self.buffer, pagesize=letter, pageCompression=1)
        self.page = 1
        self.y = TOP
        self.styles = {
            "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.7, leading=13.2, textColor=INK),
            "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8.5, leading=10.4, textColor=INK),
            "bullet": ParagraphStyle("bullet", fontName="Helvetica", fontSize=9.25, leading=11.8, leftIndent=11, firstLineIndent=-8, textColor=INK),
            "cap": ParagraphStyle("cap", fontName="Helvetica", fontSize=8.45, leading=10.2, textColor=INK),
            "evidence": ParagraphStyle("evidence", fontName="Helvetica", fontSize=8.85, leading=11.3, leftIndent=11, firstLineIndent=-8, textColor=INK),
        }

    def new_page(self):
        add_footer(self.c, self.page)
        self.c.showPage()
        self.page += 1
        self.y = TOP

    def ensure(self, needed):
        if self.y - needed < BOTTOM:
            self.new_page()

    def centered(self, text, y, font, size, color):
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        self.c.drawCentredString(PAGE_W / 2, y, text)

    def section(self, title, keep_with_next=34):
        self.ensure(keep_with_next)
        self.y -= 15
        self.c.setFont("Helvetica-Bold", 11.8)
        self.c.setFillColor(BLUE)
        self.c.drawString(LEFT, self.y, title)
        self.y -= 4
        self.c.setStrokeColor(LINE)
        self.c.setLineWidth(0.65)
        self.c.line(LEFT, self.y, RIGHT, self.y)
        self.y -= 14

    def header(self):
        role = infer_role(self.job_description)
        self.centered("BRIAN DEAR", self.y, "Helvetica-Bold", 24, PURPLE)
        self.y -= 26
        self.centered(f"Customized Resume | {role}", self.y, "Helvetica-Bold", 11.6, BLUE)
        self.y -= 16
        self.c.setStrokeColor(PURPLE)
        self.c.setLineWidth(1.6)
        self.c.line(PAGE_W / 2 - 118, self.y, PAGE_W / 2 + 118, self.y)
        self.y -= 18
        contact = f"{self.data['email']}  |  {self.data['linkedin'].replace('https://www.', '').replace('https://', '')}  |  {self.data['github'].replace('https://', '')}"
        self.centered(contact, self.y, "Helvetica", 9.6, BLUE)
        self.y -= 16
        summary = Paragraph(xml(targeted_summary(self.data, self.job_description, self.themes)), self.styles["body"])
        _, summary_h = summary.wrap(RIGHT - LEFT - 24, 1000)
        box_h = summary_h + 18
        self.c.setFillColor(PALE)
        self.c.roundRect(LEFT, self.y - box_h + 4, RIGHT - LEFT, box_h, 7, fill=1, stroke=0)
        summary.drawOn(self.c, LEFT + 12, self.y - summary_h - 5)
        self.y -= box_h + 8

    def targeted_evidence(self):
        self.section("TARGETED EVIDENCE")
        for item in project_evidence(self.data, self.job_description, self.themes):
            self.ensure(28)
            self.y = draw_paragraph(self.c, f"- {xml(clean_line(item))}", LEFT + 9, self.y, RIGHT - LEFT - 9, self.styles["evidence"]) - 4

    def capabilities(self):
        self.section("RELEVANT CAPABILITIES")
        for label, text in capability_rows(self.data, self.themes, self.job_description):
            self.ensure(24)
            self.y = draw_paragraph(self.c, f"<b>{xml(label)}:</b> {xml(clean_line(text))}", LEFT, self.y, RIGHT - LEFT, self.styles["cap"]) - 7

    def experience(self):
        self.section("PROFESSIONAL EXPERIENCE", 210)
        for job in selected_jobs(self.data, self.job_description, self.themes):
            bullets = selected_bullets(job, self.job_description, self.themes)
            self.ensure(42 + len(bullets) * 26)
            self.c.setFont("Helvetica-Bold", 10.2)
            self.c.setFillColor(INK)
            self.c.drawString(LEFT, self.y, clean_line(job["title"]))
            self.c.setFont("Helvetica-Bold", 8.8)
            self.c.drawRightString(RIGHT, self.y, f"{job['start']} - {job['end']}")
            self.y -= 12
            self.c.setFont("Helvetica-Oblique", 9.3)
            self.c.setFillColor(MUTED)
            self.c.drawString(LEFT, self.y, clean_line(job["company"]))
            self.y -= 9
            self.c.setStrokeColor(colors.HexColor("#edf0f4"))
            self.c.line(LEFT, self.y, RIGHT, self.y)
            self.y -= 12
            for bullet in bullets:
                self.y = draw_paragraph(self.c, f"- {xml(clean_line(bullet))}", LEFT + 9, self.y, RIGHT - LEFT - 9, self.styles["bullet"]) - 4
            self.y -= 10

    def education(self):
        self.section("EDUCATION")
        lines = [
            "Master of Business Administration, Texas A&M University",
            "Bachelor of Arts in Journalism and Biomedical Sciences, Texas A&M University",
            "Honors Research Fellowship, Texas A&M University",
        ]
        for line in lines:
            self.ensure(16)
            self.y = draw_paragraph(self.c, f"- {xml(line)}", LEFT + 9, self.y, RIGHT - LEFT - 9, self.styles["bullet"]) - 2

    def build(self):
        self.header()
        self.targeted_evidence()
        self.capabilities()
        self.experience()
        self.education()
        add_footer(self.c, self.page)
        self.c.save()
        return self.buffer.getvalue()


def main():
    job_description, data = load_input()
    pdf = ResumeDoc(data, job_description).build()
    sys.stdout.buffer.write(pdf)


if __name__ == "__main__":
    main()
