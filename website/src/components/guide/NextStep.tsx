import Link from "@docusaurus/Link";

import styles from "./guide.module.css";

type Action = { label: string; href: string };

type NextStepProps = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  label: string;
  secondary?: Action;
};

export default function NextStep({
  eyebrow,
  title,
  description,
  href,
  label,
  secondary,
}: NextStepProps) {
  return (
    <aside className={styles.nextStep} aria-label={eyebrow}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className={styles.nextActions}>
        <Link className={styles.primaryAction} to={href}>
          {label}
        </Link>
        {secondary ? (
          <Link className={styles.textAction} to={secondary.href}>
            {secondary.label}
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
