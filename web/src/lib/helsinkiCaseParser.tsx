import React from "react";

export interface HelCaseDetails {
  original: string;
  normalized: string;
  hasTypo: boolean;
  caseCode: string;
}

export interface RentInfo {
  annual: string | null;
  monthly: string | null;
}

// Typo-tolerant case identifier parser for HEL-case diary codes (e.g. HEL 2023- -005659)
export const parseHelCaseTypo = (text: string): HelCaseDetails | null => {
  if (!text) return null;

  const typoRegex = /HEL[\s-]*(\d{4})[\s-_]*[\s-_]*(\d{5,6})/i;
  const match = text.match(typoRegex);
  if (match) {
    const year = match[1];
    const num = match[2];
    const normalized = `HEL ${year}-${num}`;
    const originalMatch = match[0];
    const isStandard = /^HEL\s\d{4}-\d{6}$/.test(originalMatch);

    return {
      original: originalMatch,
      normalized: normalized,
      hasTypo: !isStandard,
      caseCode: `hel-${year}-${num}`
    };
  }
  return null;
};

// Financial rent extractor (matches annual "vuosivuokra" or monthly "kuukausivuokra" text + amounts)
export const extractRentInfo = (text: string): RentInfo | null => {
  if (!text) return null;

  let annualRent: string | null = null;
  let monthlyRent: string | null = null;

  const cleanAmount = (val: string) => val.trim().replace(/[.,\s]+$/, "");
  const currencyGroup = "(?:euroa|euron|euro|\\be\\b|€)";
  const currencyGroupWithEur = "(?:€|euroa|euron|euro|\\be\\b|\\beur\\b)";

  // 1. Annual Rent (vuosivuokra)
  const annualPatterns = [
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:vuodessa|vuosittain|vuodelta)`, "i"),
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:vuosivuokra[a-z]*)`, "i"),
    new RegExp(`(?:vuosivuokra[a-z]*)\\s*(?:on\\s*)?(\\d+[\\d\\s,.]*)\\s*${currencyGroup}`, "i"),
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroupWithEur}\\s*\\/\\s*(?:v|vuosi)`, "i")
  ];

  for (const pattern of annualPatterns) {
    const match = text.match(pattern);
    if (match) {
      annualRent = cleanAmount(match[1]);
      break;
    }
  }

  // 2. Monthly Rent (kuukausivuokra)
  const monthlyPatterns = [
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:kuukaudessa|kuukausittain|kuukaudelta)`, "i"),
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:kuukausivuokra[a-z]*)`, "i"),
    new RegExp(`(?:kuukausivuokra[a-z]*)\\s*(?:on\\s*)?(\\d+[\\d\\s,.]*)\\s*${currencyGroup}`, "i"),
    new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroupWithEur}\\s*\\/\\s*kk`, "i")
  ];

  for (const pattern of monthlyPatterns) {
    const match = text.match(pattern);
    if (match) {
      monthlyRent = cleanAmount(match[1]);
      break;
    }
  }

  // 3. General Rent fallback
  if (!annualRent && !monthlyRent) {
    const generalPatterns = [
      new RegExp(`(\\d+[\\d\\s,.]*)\\s*${currencyGroup}\\s*(?:n\\s*)?(?:vuokra[a-z]*)`, "i"),
      new RegExp(`(?:vuokra[a-z]*)\\s*(?:on\\s*)?(\\d+[\\d\\s,.]*)\\s*${currencyGroup}`, "i")
    ];
    for (const pattern of generalPatterns) {
      const match = text.match(pattern);
      if (match) {
        monthlyRent = cleanAmount(match[1]);
        break;
      }
    }
  }

  if (annualRent || monthlyRent) {
    return { annual: annualRent, monthly: monthlyRent };
  }
  return null;
};

// Auto hyperlink parser for descriptions (handles URLs, HEL-cases, and Sopimus/Plot contract codes)
export const renderTextWithLinks = (text: string): React.ReactNode => {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const helRegex = /HEL[\s-]*\d{4}[\s-_]*[\s-_]*\d{5,6}/i;
  const sopimusRegex = /\b091-\d+-\d+-\d+(?:-\d+)?\b/i;
  const combinedRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|HEL[\s-]*\d{4}[\s-_]*[\s-_]*\d{5,6}|\b091-\d+-\d+-\d+(?:-\d+)?\b)/gi;
  const parts = text.split(combinedRegex);

  let keyCount = 0;
  return parts.map((part) => {
    keyCount += 1;
    if (part.match(urlRegex)) {
      const href = part.startsWith("http") ? part : `https://${part}`;
      return (
        <a
          key={keyCount}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-nc-neon-teal hover:text-white underline font-bold cursor-pointer break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    if (part.match(helRegex)) {
      const caseDetails = parseHelCaseTypo(part);
      if (caseDetails) {
        const href = `https://paatokset.hel.fi/fi/asia/${caseDetails.caseCode}`;
        return (
          <a
            key={keyCount}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-nc-neon-teal hover:text-white underline font-bold cursor-pointer break-all"
            onClick={(e) => e.stopPropagation()}
            title={caseDetails.hasTypo ? `Original typo: ${caseDetails.original}` : undefined}
          >
            {caseDetails.normalized}
            {caseDetails.hasTypo && (
              <span className="ml-1 text-[9px] text-nc-gold opacity-90 font-black tracking-wide">
                (⚠️ typo corrected)
              </span>
            )}
          </a>
        );
      }
    }
    if (part.match(sopimusRegex)) {
      const match = part.match(/\b091-\d+-\d+-\d+(?:-\d+)?\b/i);
      const contractId = match ? match[0] : part;
      const href = `https://paatokset.hel.fi/fi/haku?search_api_fulltext=${encodeURIComponent(contractId)}`;
      return (
        <a
          key={keyCount}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-orange-400 hover:text-white underline font-bold cursor-pointer break-all"
          onClick={(e) => e.stopPropagation()}
          title={`Search Helsinki Decisions for contract/plot ${contractId}`}
        >
          {part}
        </a>
      );
    }
    return part;
  });
};
