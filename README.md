# Repair & Service Management

A working prototype of a multi-company (SaaS) app for repair and maintenance businesses, such as roller-shutter and door service companies.

It covers the whole job, from the first enquiry to the final payment:
- repair jobs
- general servicing
- annual maintenance contracts (AMC)

There's a web view for the office and a mobile view for technicians, and each user sees their own menu.

**Status:** prototype in progress. Parts 1 and 2 and the first half of part 3 are built: masters, enquiries, site inspection, the money side of a repair job (estimate, quotation with an approval step, scheduling, the technician's job and Work Done form on the phone, invoice, payment and job closure), and AMC contracts and general servicing (AMC estimate, contract with visit plan and billing plan, visit scheduling, the inspection checklist on the phone, invoices from the billing plan, renewals). Admin screens and dashboards come next.

## What it covers

- Enquiries, site inspection reports and assigning technicians by zone
- Cost estimates with job-level or line-level costing, and quotation revisions with an approval step
- Job scheduling, work-done forms with customer sign-off, invoices and payment recording
- AMC contracts, planned maintenance visits and inspection checklists
- Masters, roles, menu access, approval levels and per-company tax and country settings

## Run it

The prototype is plain HTML, CSS and JavaScript, with no install or build step. Serve the `prototype` folder from a local web server so that every feature works, including voice input:

```bash
cd prototype
python -m http.server 8000
```

Then open http://localhost:8000.

## Try it

- Log in as a demo user; there are no passwords. The made-up company "Demo Shutters Pte Ltd" has an Admin, an operations executive, an approver, two technicians and a management user. "Gulf Demo Doors LLC" is a second made-up company (UAE, AED) with its own data.
- Use the Web / Mobile switch at the top. Technicians work in the Mobile view.
- Press Ctrl+K to search everything your role can open.
- Suggested walk-through, part 1: as the operations executive, use "Paste email" to enter an enquiry and assign a technician; then switch to Mobile, log in as that technician, fill in the site report and sign it; the report then appears on the web.
- Stage samples: besides that enquiry, the sample data has one repair enquiry waiting at every later step, so each step can be tried on its own: an estimate being prepared, quotations waiting for the approver or for Management (over 10,000), approved, sent or rejected, a job to schedule with a part on order, a scheduled job, a technician on site waiting for the office's OK to leave, a draft invoice, an invoice due soon, an overdue part-paid invoice, and a closed job.
- AMC: open ENQ-…-0001 (ABC Industries, BOQ study) and click "Create estimate", then "Create quotation". After the approver's check, send it and record the PO: the AMC contract opens as a draft. Activate it, book the first visit on AMC Scheduling, and do the visit as Technician A in the Mobile view (checklist per shutter; a failed item creates a repair enquiry). Invoices come from the contract's billing plan. ENQ-…-0024 (Demo Cafe) runs the same way as a one-off general servicing job without a contract.
- AMC stage samples: AMC estimates and quotations at each step, a contract to activate, active contracts with visits to confirm or assign and instalments to post, a contract near its end with a renewal reminder, and general servicing jobs scheduled and done.
- Part 2: open the inspected enquiry ENQ-…-0003 and click "Create estimate", then "Create quotation" and "Submit for check". Log in as the approver to approve or return it (task bell at the top). Send it, record the customer's acceptance, and schedule the job on the board. Log in as Technician A in the Mobile view to do the job, collect the payment and ask to leave the site; the operations executive confirms in Tasks. Finally mark the job "Completed & documented" in Job Closure.

## Demo data

The demo data is sample test data. Documents the prototype prints (quotations, invoices, reports) are marked "DEMO" and are not valid business documents. Data is kept in your browser only, and the app has a "Reset demo data" button.
