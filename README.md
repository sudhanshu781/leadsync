# Facebook Lead Ads to Google Sheets Integration

This Node.js application syncs Facebook Lead Ads data to Google Sheets automatically.

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables in `.env`:
   - `FACEBOOK_ACCESS_TOKEN`: Your Facebook API access token
   - `FACEBOOK_APP_ID`: Your Facebook App ID
   - `FACEBOOK_APP_SECRET`: Your Facebook App Secret
   - `GOOGLE_SHEETS_ID`: ID of your Google Sheet
   - `GOOGLE_CLIENT_EMAIL`: Google Service Account email
   - `GOOGLE_PRIVATE_KEY`: Google Service Account private key

4. Set up Facebook Lead Ads:
   - Create a Facebook App
   - Set up Lead Ads form
   - Get the form ID

5. Set up Google Sheets:
   - Create a new Google Sheet
   - Share it with your service account email
   - Copy the Sheet ID from the URL

## Usage

1. Start the server:
   ```bash
   node index.js
   ```

2. Trigger sync by accessing:
   ```
   http://localhost:3000/sync-leads/{formId}
   ```
   Replace `{formId}` with your Facebook Lead Ads form ID.

## Requirements

- Node.js 14+
- Facebook Developer Account
- Google Cloud Project with Sheets API enabled
- Google Service Account with appropriate permissions
