import Link from "@docusaurus/Link";

import styles from "./guide.module.css";

type Action = {
  label: string;
  href: string;
};

type GuideHeroProps = {
  eyebrow: string;
  title: string;
  summary: string;
  primary: Action;
  secondary?: Action;
};

export default function GuideHero({ eyebrow, title, summary, primary, secondary }: GuideHeroProps) {
  return (
    <header className={styles.hero} data-testid="guide-hero">
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.heroTitle}>{title}</h1>
      <p className={styles.heroSummary}>{summary}</p>
      <div className={styles.heroActions}>
        <Link className={styles.primaryAction} to={primary.href}>
          {primary.label}
        </Link>
        {secondary ? (
          <Link className={styles.secondaryAction} to={secondary.href}>
            {secondary.label}
          </Link>
        ) : null}
      </div>
    </header>
  );
}
