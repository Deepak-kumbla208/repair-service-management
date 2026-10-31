// "Paste an email" intake: reads a pasted email and suggests enquiry fields (a stand-in for OCR / scanning).
// A person always checks the suggestions before saving.
import { findDuplicates, primaryContact } from './customers.js';

export const SAMPLE_EMAIL = `From: Kosmic Facilities <facilities@kosmic.example>
Subject: Urgent - shutter repair at IMM L1 shop

Hi team,

Our front shop roller shutter (RS-1) motor is not working and needs to be replaced. The side godown shutter (RS-2) is jammed and the spring looks broken.
Site: IMM Building L1 Shop @ Jurong East
Please send someone today.

Regards,
Facilities Manager
Kosmic M&E Services Pte Ltd
Mobile: 9876 5432`;

const COMPANY_RE = /\b(pte\.? ?ltd|sdn\.? bhd|llc|l\.l\.c|limited|ltd|services|industries|trading|corporation|company)\b/i;
const SIGN_OFF_RE = /^(regards|best regards|kind regards|thanks|thank you|best|cheers)\b/i;

function phoneIn(text) {
  const m = text.match(/(?:\+?65[\s-]?)?\b([689]\d{3})[\s-]?(\d{4})\b/) || text.match(/\b(05\d)[\s-]?(\d{3}[\s-]?\d{4})\b/);
  return m ? `${m[1]} ${m[2]}` : '';
}

export function parseEmail(text) {
  const t = String(text || '').replace(/\r/g, '');
  const lines = t.split('\n').map(l => l.trim());
  const header = k => (t.match(new RegExp(`^${k}:\\s*(.+)$`, 'im')) || [])[1]?.trim() || '';

  const from = header('From');
  const fromName = from.replace(/<.*>/, '').replace(/"/g, '').trim();
  const email = (from.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || '';
  const subject = header('Subject');
  const mobile = phoneIn(t);
  const siteText = header('Site') || header('Location') || header('Address');

  // Body: lines after the headers, up to the sign-off; greeting and site line removed.
  const start = lines.findIndex((l, i) => i > 0 && l === '' && lines.slice(0, i).some(x => /^(from|subject):/i.test(x)));
  const body = lines.slice(start >= 0 ? start + 1 : 0);
  const stop = body.findIndex(l => SIGN_OFF_RE.test(l));
  const bodyLines = body.slice(0, stop >= 0 ? stop : body.length)
    .filter(l => l && !/^(hi|hello|dear)\b/i.test(l) && !/^(site|location|address):/i.test(l) && !/^(from|subject|to|cc|date):/i.test(l));
  const description = bodyLines.join(' ');
  const signature = stop >= 0 ? body.slice(stop + 1) : [];
  const companyLine = signature.find(l => COMPANY_RE.test(l)) || '';

  const all = `${subject} ${description}`;
  const type = /\b(amc|annual maintenance|maintenance contract)\b/i.test(all) ? 'AMC'
    : /\bservic(e|ing)\b/i.test(all) && !/\brepair|broken|jam|not working\b/i.test(all) ? 'GS' : 'REPAIR';
  const urgent = /\b(urgent|asap|immediately|today|emergency)\b/i.test(all);

  // Match an existing customer by mobile / email / company name, then the site by name.
  const dup = findDuplicates({ mobile, email, name: companyLine })[0];
  const customer = dup?.customer || null;
  let site = null;
  if (customer && siteText) {
    const s = siteText.toLowerCase();
    site = customer.sites.find(x => x.name.toLowerCase() === s) || customer.sites.find(x => s.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(s)) || null;
  }
  const contact = customer ? (customer.contacts.find(c => email && c.email.toLowerCase() === email.toLowerCase()) || primaryContact(customer)) : null;

  return {
    fields: {
      channel: 'EMAIL', type, priority: urgent ? 'HIGH' : 'MEDIUM', enquiryStatus: urgent ? 'HOT' : 'WARM',
      contactName: contact?.name || fromName || '', mobile: mobile || contact?.mobile || '', email,
      customerName: customer?.name || companyLine, siteText, description: subject ? `${subject}. ${description}` : description,
    },
    customer, contact, site,
  };
}
