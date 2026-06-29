export type RoleType =
  | "rails"
  | "ai_platform"
  | "product_engineering"
  | "vp_platform"
  | "healthcare"
  | "startup"
  | "general";

export type ProjectTheme =
  | "healthcare"
  | "ai"
  | "rails"
  | "platform"
  | "leadership"
  | "regulated_systems"
  | "startup"
  | "developer_productivity"
  | "product_engineering";

export type QuestionType =
  | "ownership"
  | "ambiguity"
  | "leadership"
  | "failure"
  | "ai"
  | "healthcare"
  | "platform"
  | "conflict"
  | "technical_depth";

export type RoleLevel =
  | "senior_engineer"
  | "staff_engineer"
  | "engineering_manager"
  | "director"
  | "vp"
  | "contract";

export type Market = "us_remote" | "europe_remote" | "contract_us";

export interface CareerData {
  name: string;
  email: string;
  linkedin: string;
  github: string;
  headline: string;
  tagline: string;
  privacy_note: string;
  positioning: string[];
  best_fit_roles: string[];
  public_links: Array<{ label: string; url: string }>;
  skills: Record<string, string[]>;
  experience: Array<{
    company: string;
    title: string;
    start: string;
    end: string;
    highlights: string[];
  }>;
  projects: Array<{
    name: string;
    themes: ProjectTheme[];
    summary: string;
    context: string;
    role: string;
    contributions: string[];
    impact: string;
    interview_angle: string;
  }>;
  stories: Partial<Record<QuestionType, string>>;
  role_summaries: Record<RoleType, string>;
  keywords: Record<string, string[]>;
}

export interface JobMatch {
  fit_score: number;
  strongest_matches: string[];
  possible_gaps: string[];
  recommended_positioning: string[];
  suggested_cover_letter_angle: string;
  learning?: {
    applied: boolean;
    adjustment: number;
    examples: Array<{
      evaluation_id: string;
      similarity: number;
      rating: EvalRating;
      original_score: number;
      adjustment: number;
    }>;
  };
}

export type EvalRating = "good" | "bad" | "incomplete" | "too_high" | "too_low";
