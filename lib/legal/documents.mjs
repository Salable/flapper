/**
 * The legal documents the site publishes, and what state each is in.
 *
 * A document is a markdown file under docs/legal/. Until a real one is
 * written its `status` is `placeholder`: the page carries a banner saying so,
 * the footer shows no effective date, and tests assert the file still says
 * `[[PLACEHOLDER` somewhere. Flipping `status` to `published` and setting
 * `effectiveDate` is how a document goes live - nothing else moves.
 *
 * `TERMS_VERSION` is what a signup records against `user.termsVersion`; bump
 * it when the Terms change in a way that needs re-acceptance.
 *
 * Pure and client-safe: the signup form and the footer import this.
 */

export const TERMS_VERSION = '0-placeholder';

/** The address privacy requests go to until the real one is known. */
export const PRIVACY_CONTACT = '[[PLACEHOLDER: privacy@example.com]]';

export const LEGAL_DOCUMENTS = Object.freeze([
  Object.freeze({ slug: 'terms', title: 'Terms of Service', file: 'terms.md', status: 'placeholder', effectiveDate: null, blurb: 'The agreement between you and Flapper for using the service.' }),
  Object.freeze({ slug: 'privacy', title: 'Privacy Notice', file: 'privacy.md', status: 'placeholder', effectiveDate: null, blurb: 'What personal data Flapper holds, why, for how long, and your rights.' }),
  Object.freeze({ slug: 'cookies', title: 'Cookie Policy', file: 'cookies.md', status: 'placeholder', effectiveDate: null, blurb: 'The cookies the site sets - strictly necessary ones only, so no banner.' }),
  Object.freeze({ slug: 'eula', title: 'Desktop App Licence', file: 'eula.md', status: 'placeholder', effectiveDate: null, blurb: 'The licence for the Flapper desktop kiosk app.' }),
  Object.freeze({ slug: 'company', title: 'Company Details', file: 'company.md', status: 'placeholder', effectiveDate: null, blurb: 'Who runs Flapper: registered name, number, office, and how to reach us.' }),
]);

export function legalDocument(slug) {
  return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug) ?? null;
}

/** The short line the footer prints. Placeholders are visibly placeholders. */
export const COMPANY_LINE = '[[PLACEHOLDER: Company name]] · Registered in England and Wales No. [[PLACEHOLDER: 00000000]]';
