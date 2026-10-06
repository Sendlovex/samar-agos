# Advisory emails (Google Apps Script)

Emails residents when the water provider publishes, updates or resolves a service advisory in SAMAR-AGOS.

Every 5 minutes the script reads the `advisories` collection in Firestore. For each change it emails every resident account whose barangay is in the advisory's affected barangays. Staff accounts are skipped.

| Event | Subject |
|---|---|
| Advisory published | Water service advisory: *title* |
| Advisory edited (message, next update, restoration time) | Advisory update: *title* |
| Advisory resolved | Service restored: *title* |
| Responder added under Work Orders | Your SAMAR-AGOS responder account |

The responder email goes to the address staff entered and contains the generated sign-in email and temporary password. After sending, the script deletes the password from the `responders` document. If you set this script up before responders existed, paste the new `Code.gs` and choose **Deploy → Manage deployments → Edit → New version** so the web app runs the new code.

## Setup

1. **Service account key.** In the Firebase console, open *Project settings → Service accounts → Generate new private key*. Keep the downloaded JSON file private; it gives full database access.
2. **Create the script.** Go to [script.google.com](https://script.google.com), create a new project and name it *SAMAR-AGOS advisory emails*.
   - Replace `Code.gs` with the contents of `Code.gs` from this folder.
   - In *Project settings*, tick *Show "appsscript.json" manifest file*, then replace it with `appsscript.json` from this folder.
3. **Script properties.** In *Project settings → Script properties*, add:

   | Property | Value |
   |---|---|
   | `SERVICE_ACCOUNT_JSON` | The whole content of the key file (required) |
   | `APP_URL` | Link to the SAMAR-AGOS app, shown as a button in the email (optional) |
   | `SENDER_NAME` | Sender name; default "Catbalogan Water District (SAMAR-AGOS)" (optional) |
   | `REPLY_TO` | Reply-to address, e.g. the utility's customer service email (optional) |

4. **Test.** Select `sendTestEmail` and click *Run*. Approve the permissions. A sample email for the latest advisory is sent to your own address only.
5. **Start.** Select `setup` and click *Run*. Existing advisories are marked as already sent, so residents only get emails for changes from now on. A 5-minute timer is installed.

## Notes

- **Sending limits:** Gmail accounts can send about 100 emails a day from Apps Script; Google Workspace accounts about 1,500. When the limit is reached, the remaining residents are emailed on the next run after the quota resets. Those already emailed may get the email again on that retry.
- **Sender address:** emails are sent from the Google account that owns the script. Use a utility account rather than a personal one.
- **Changes older than 24 hours** are not emailed, so the script does not send a backlog after a long pause.
- **Stop emails:** in the editor, open *Triggers* and delete the `checkAdvisories` trigger.
