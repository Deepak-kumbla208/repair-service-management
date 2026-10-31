# Repair & Service Management

A working prototype of a multi-company (SaaS) app for repair and maintenance businesses, such as roller-shutter and door service companies.

It covers the whole job, from the first enquiry to the final payment:
- repair jobs
- general servicing
- annual maintenance contracts (AMC)

There's a web view for the office and a mobile view for technicians, and each user sees their own menu.

**Status:** prototype in progress.

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

## Demo data

The demo data is sample test data. Documents the prototype prints (quotations, invoices, reports) are marked "DEMO" and are not valid business documents. Data is kept in your browser only, and the app has a "Reset demo data" button.
