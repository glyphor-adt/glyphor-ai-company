/**
 * Glyphor Logo — base64-encoded SVG for embedding in PPTX / DOCX exports.
 * pptxgenjs accepts data URIs via `slide.addImage({ data: '...' })`.
 */

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220" fill="none">
  <defs>
    <linearGradient id="glyphorGrad" x1="100" y1="0" x2="100" y2="220" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#00E0FF"/>
      <stop offset="100%" stop-color="#0097FF"/>
    </linearGradient>
  </defs>
  <path d="M100 10 L178 52 L178 148 L100 190 L22 148 L22 52 Z" stroke="url(#glyphorGrad)" stroke-width="10" stroke-linejoin="round" fill="none"/>
  <path d="M100 38 L156 70 L156 134 L100 166 L44 134 L44 70 Z" stroke="url(#glyphorGrad)" stroke-width="6" stroke-linejoin="round" fill="none"/>
  <line x1="100" y1="50" x2="100" y2="175" stroke="url(#glyphorGrad)" stroke-width="5"/>
  <line x1="100" y1="65" x2="68" y2="65" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <line x1="68" y1="65" x2="55" y2="80" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <circle cx="55" cy="80" r="5" fill="url(#glyphorGrad)"/>
  <line x1="100" y1="90" x2="60" y2="90" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <line x1="60" y1="90" x2="52" y2="100" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <circle cx="52" cy="100" r="5" fill="url(#glyphorGrad)"/>
  <line x1="100" y1="110" x2="70" y2="110" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <circle cx="70" cy="110" r="5" fill="url(#glyphorGrad)"/>
  <line x1="100" y1="135" x2="65" y2="135" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <line x1="65" y1="135" x2="55" y2="125" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <circle cx="55" cy="125" r="5" fill="url(#glyphorGrad)"/>
  <line x1="68" y1="65" x2="70" y2="110" stroke="url(#glyphorGrad)" stroke-width="3"/>
  <line x1="100" y1="75" x2="132" y2="75" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <line x1="132" y1="75" x2="140" y2="65" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <circle cx="140" cy="65" r="5" fill="url(#glyphorGrad)"/>
  <line x1="100" y1="100" x2="140" y2="100" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <circle cx="140" cy="100" r="5" fill="url(#glyphorGrad)"/>
  <line x1="100" y1="120" x2="135" y2="120" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <line x1="135" y1="120" x2="145" y2="130" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <circle cx="145" cy="130" r="5" fill="url(#glyphorGrad)"/>
  <line x1="100" y1="145" x2="130" y2="145" stroke="url(#glyphorGrad)" stroke-width="4"/>
  <circle cx="130" cy="145" r="5" fill="url(#glyphorGrad)"/>
  <line x1="132" y1="75" x2="135" y2="120" stroke="url(#glyphorGrad)" stroke-width="3"/>
  <circle cx="100" cy="65" r="4" fill="url(#glyphorGrad)"/>
  <circle cx="100" cy="90" r="4" fill="url(#glyphorGrad)"/>
  <circle cx="100" cy="110" r="4" fill="url(#glyphorGrad)"/>
  <circle cx="100" cy="135" r="4" fill="url(#glyphorGrad)"/>
</svg>`;

/** Base64-encoded SVG data URI for pptxgenjs addImage({ data }) */
export const LOGO_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(LOGO_SVG).toString('base64')}`;

/** Raw SVG string (for docx or other embedding) */
export const LOGO_SVG_RAW = LOGO_SVG;
