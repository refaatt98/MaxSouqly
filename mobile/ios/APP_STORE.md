# App Store delivery without a Mac

This adds a separate, manual GitHub macOS workflow. It leaves the existing unsigned
mobile release and Android builds unchanged. It uploads to App Store Connect for
TestFlight, not to public App Store review. Apple approval is a later, separate step.

## 1. Apple account preparation (browser only)

1. Accept any pending Apple Developer/App Store Connect agreements.
2. In Certificates, Identifiers & Profiles, register an explicit App ID for
   `com.souqly.maxmanagement` if it does not already exist. Select the same developer
   team used below.
3. In App Store Connect, create the iOS app record: name **MAX Management**, bundle ID
   `com.souqly.maxmanagement`, a unique SKU such as `max-management-ios`, and your
   chosen primary language. If the app already exists, reuse its record.
4. In App Store Connect → Users and Access → Integrations → App Store Connect API,
   request API access if needed, then generate a **team API key** with **Admin** access.
   This workflow needs permission to manage signing assets as well as upload builds.
   Download the `.p8` once; keep it private. Individual keys are not supported here.
5. Find your Apple Developer Team ID in your developer membership details.

Never paste the `.p8`, passwords, certificates, or tokens into chat, issues, or source
files. This conversation cannot currently open a secure secrets form.

## 2. Secure GitHub configuration

In this repository's Settings → Secrets and variables → Actions, add these
**repository secrets**, using GitHub's secure input fields:

| Secret name | Content |
| --- | --- |
| `ASC_KEY_ID` | Apple API key ID |
| `ASC_ISSUER_ID` | Team API key issuer ID |
| `ASC_KEY_CONTENT` | Entire downloaded `.p8` file, including its header and footer; not Base64 |
| `MATCH_PASSWORD` | A new long random encryption password saved in your password manager |

Add this **repository variable**:

| Variable name | Content |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer Team ID (not the issuer ID) |

No personal GitHub access token is needed: the workflow uses its short-lived,
repository-scoped `GITHUB_TOKEN`.

## 3. Initialize signing once

After merging the workflow into the repository's **default branch**, open
Actions → iOS App Store → Run workflow. Choose the default branch and the
`initialize-signing` operation.

Running this operation authorizes Fastlane match to create or reuse an Apple
Distribution certificate and App Store provisioning profile. It does not revoke
existing certificates, but a team already at Apple's certificate limit will need
manual resolution. Do not revoke another app's certificate to work around a limit.

The private key, certificate, and profile are password-encrypted with
`MATCH_PASSWORD` and committed to an `ios-signing` branch in this **private**
repository. Unencrypted signing files are used only on the disposable macOS runner;
they are not uploaded as build artifacts. Do not make this repository public or
share the encryption password. Keep the signing branch and password for later
releases; losing them prevents reuse of these credentials.

GitHub branch/ruleset policies must permit the Actions token to create/write the
`ios-signing` branch. Do not weaken protections on the application/default branch.
macOS Actions jobs may consume paid GitHub Actions minutes.

## 4. Upload a build

Run the same workflow with operation `testflight`. Routine uploads use existing
signing assets in read-only mode and never create replacement certificates.

The workflow checks that the runner selects Xcode 26 or newer. If that check fails,
select an installed supported Xcode version or update the runner image before retrying.
Build numbers use the workflow run number and attempt, so a rerun gets a new number.
If an existing App Store build has a larger number, adjust the numbering first.

When the upload succeeds, wait for Apple's processing in App Store Connect →
TestFlight. Upload success is not proof of processing or review success. Add internal
testers there. External TestFlight testing may require a separate beta review.

## 5. Submit separately for App Store review

Test the actual signed build on iPhone/iPad, especially login, exports/sharing,
printing, camera/photo selection, offline behavior, and external links.
Then provide screenshots for supported devices, description, support URL, privacy
policy URL, accurate App Privacy disclosures, age rating, and export-compliance
answers. Supply working reviewer access if login is required, through Apple's
review-information fields, not this repository.

The existing encryption declaration must be verified against the app's actual
behavior; this workflow does not establish legal export-compliance eligibility.

Apple guideline 4.2 requires sufficient app-like functionality beyond a repackaged
website. The wrapper includes native printing and sharing, but that does not
guarantee acceptance. Account deletion and purchase rules may also apply depending
on the web app's actual account and payment features.

Select the processed build and submit for review only after these checks.
Nothing in this workflow submits for public App Store review or releases the app.

## Verification boundary

Workflow configuration and scripts can be checked before signing setup, but an
actual signed archive/upload cannot be verified until the Apple configuration and
GitHub secrets are in place. Keep error messages free of secret values when asking
for help.
