import useBaseUrl from "@docusaurus/useBaseUrl";
import proofManifest from "@site/static/img/guide/visual-proof/metrics.json";

import styles from "./guide.module.css";

type Locale = "ko" | "en";

const proof = {
  ko: [
    { file: "baseline.png", title: "1. 기준 화면", alt: "선택한 레거시 화면의 비교 기준" },
    { file: "actual.png", title: "2. 결과 화면", alt: "대상 구현을 같은 조건으로 캡처한 화면" },
    { file: "diff.png", title: "3. 차이", alt: "RGBA 색상 차이가 있는 픽셀을 표시한 화면" },
    {
      file: "overlay.png",
      title: "4. 겹침",
      alt: "기준 화면과 결과 화면을 절반씩 합성한 화면",
    },
  ],
  en: [
    {
      file: "baseline.png",
      title: "1. Baseline",
      alt: "Baseline PNG for the selected legacy screen",
    },
    {
      file: "actual.png",
      title: "2. Actual",
      alt: "PNG captured from the target implementation under the same conditions",
    },
    { file: "diff.png", title: "3. Diff", alt: "Diff PNG showing pixels with RGBA distance" },
    { file: "overlay.png", title: "4. Overlay", alt: "Overlay PNG averaging baseline and actual" },
  ],
} satisfies Record<Locale, Array<{ file: string; title: string; alt: string }>>;

export default function VisualProof({ locale }: { locale: Locale }) {
  const assetRoot = useBaseUrl("/img/guide/visual-proof/");
  const { metrics } = proofManifest;
  const asPercent = (value: number) => `${(value * 100).toFixed(2)}%`;
  const metricItems = [
    {
      value: asPercent(metrics.reviewMatchRatio),
      label: locale === "ko" ? "검토 일치율" : "observed review match",
    },
    {
      value: asPercent(metrics.exactMatchRatio),
      label: locale === "ko" ? "정확 일치율" : "observed exact match",
    },
    {
      value: metrics.meanDistance.toFixed(4),
      label: locale === "ko" ? "평균 RGBA 색상 거리" : "mean RGBA distance",
    },
    {
      value: metrics.maxDistance.toFixed(4),
      label: locale === "ko" ? "최대 RGBA 색상 거리" : "maximum RGBA distance",
    },
    {
      value: metrics.pixelTolerance.toFixed(2),
      label: locale === "ko" ? "선형 색 거리 허용치" : "linear color-distance tolerance",
    },
    {
      value: asPercent(metrics.threshold),
      label: locale === "ko" ? "최소 통과 일치율" : "minimum review threshold",
    },
    {
      value: asPercent(metrics.maskedAreaRatio),
      label: locale === "ko" ? "제외 영역 · 최대 20%" : "observed mask area · 20% maximum",
    },
    {
      value: `${proofManifest.attempt} / 3`,
      label: locale === "ko" ? "사용한 비교 횟수" : "comparison attempt used",
    },
  ];

  return (
    <section
      className={styles.visualProof}
      data-testid="visual-proof"
      aria-label={locale === "ko" ? "실제 시각 비교 산출물" : "Authentic visual comparison outputs"}
    >
      <div className={styles.proofMetrics}>
        {metricItems.map((item) => (
          <p key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </p>
        ))}
      </div>
      <div className={styles.proofGrid}>
        {proof[locale].map((item) => (
          <figure className={styles.proofCard} key={item.file}>
            <img
              src={`${assetRoot}${item.file}`}
              alt={item.alt}
              loading="lazy"
              width="960"
              height="560"
            />
            <figcaption>{item.title}</figcaption>
          </figure>
        ))}
      </div>
      <p className={styles.proofCaption}>
        {locale === "ko"
          ? "같은 고정 데이터로 Playwright가 기준 화면과 결과 화면을 캡처합니다. compareVisualPngs는 pngjs로 RGBA 값을 읽어 일치율과 차이·겹침 화면을 만듭니다. 수정 후 비교는 최대 세 번까지 진행하며, 디자인 검토자가 각 화면의 출처와 현재 검토 묶음의 연결을 확인합니다."
          : "Playwright captured baseline and actual from the same fixture; production compareVisualPngs decoded RGBA with pngjs and produced metrics, diff, and overlay. Repairs stay within three total comparisons, and the design reviewer verifies provenance and current-packet binding."}{" "}
        <a href={`${assetRoot}metrics.json`}>
          {locale === "ko"
            ? "해시가 포함된 metrics.json 보기"
            : "Inspect metrics.json with digests"}
        </a>
      </p>
    </section>
  );
}
