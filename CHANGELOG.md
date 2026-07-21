# Changelog

All notable changes to this project are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Live Supabase database, Storage, and API request usage collection through the Management API, with optional trusted MAU and egress summaries.
- Live Resend daily and monthly email quota collection from API response headers, without retaining email-list contents.

## [0.2.0] - 2026-07-21

### Added

- Live MongoDB Atlas usage collection with process auto-selection and normalized storage, connection, and operation metrics.
- Live Vercel billing usage collection from FOCUS-formatted charges, including project and resource metadata.
- Continuous integration across supported Node.js versions.
- Automated coverage for provider collectors, summary normalization, threshold boundaries, aggregation, and provider error isolation.

### Security

- Provider credentials remain server-side inputs and are not included in normalized metric output.

## [0.1.0] - 2026-07-17

### Added

- Initial normalized usage metric model and threshold classification.
- Cloudflare R2 and Upstash Redis live collectors.
- Resend and Supabase summary adapters.
- Framework-independent collection API, configuration guidance, and integration example.
