require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const bizSdk = require('facebook-nodejs-business-sdk');
const axios = require('axios');

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

// Facebook configuration
const FACEBOOK_API_VERSION = 'v18.0';
const api = bizSdk.FacebookAdsApi.init(process.env.FACEBOOK_ACCESS_TOKEN);
const Lead = bizSdk.Lead;
const Form = bizSdk.LeadgenForm;
const Page = bizSdk.Page;
const Business = bizSdk.Business;

// Store page-to-sheet mappings
const pageToSheetMap = new Map();

// Function to save mapping to a JSON file
async function saveMappings() {
  const mappings = {};
  for (const [pageId, config] of pageToSheetMap.entries()) {
    mappings[pageId] = config;
  }
  await fs.promises.writeFile('page_mappings.json', JSON.stringify(mappings, null, 2));
}

// Function to load mappings from JSON file
async function loadMappings() {
  try {
    const data = await fs.promises.readFile('page_mappings.json', 'utf8');
    const mappings = JSON.parse(data);
    for (const [pageId, config] of Object.entries(mappings)) {
      pageToSheetMap.set(pageId, config);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error loading mappings:', error);
    }
  }
}

// Function to get all pages from a paginated endpoint
async function getAllPaginatedData(url, params) {
  let allData = [];
  let nextPage = url;

  while (nextPage) {
    const response = await axios.get(nextPage, { params });
    const data = response.data;

    if (data.data) {
      allData = allData.concat(data.data);
    }

    // Check if there's a next page
    nextPage = data.paging?.next;
    if (nextPage) {
      // Remove the access_token from params as it's already in the next URL
      params = {};
    }
  }

  return allData;
}

// Function to get all pages including business pages
async function getAllPages() {
  try {
    // First, get user's direct pages
    const pages = await getAllPaginatedData(
      `https://graph.facebook.com/${FACEBOOK_API_VERSION}/me/accounts`,
      {
        access_token: process.env.FACEBOOK_ACCESS_TOKEN,
        fields: 'id,name,access_token',
        limit: 100 // Get more pages per request
      }
    );

    // Then, get businesses the user has access to
    const businesses = await getAllPaginatedData(
      `https://graph.facebook.com/${FACEBOOK_API_VERSION}/me/businesses`,
      {
        access_token: process.env.FACEBOOK_ACCESS_TOKEN,
        fields: 'id,name',
        limit: 100
      }
    );

    // For each business, get its pages
    for (const business of businesses) {
      const businessPages = await getAllPaginatedData(
        `https://graph.facebook.com/${FACEBOOK_API_VERSION}/${business.id}/owned_pages`,
        {
          access_token: process.env.FACEBOOK_ACCESS_TOKEN,
          fields: 'id,name,access_token',
          limit: 100
        }
      );
      
      pages.push(...businessPages.map(page => ({
        ...page,
        business_name: business.name
      })));
    }

    return pages;
  } catch (error) {
    console.error('Error fetching pages:', error.response?.data || error.message);
    throw error;
  }
}

// Google Sheets configuration
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// Function to append data to Google Sheets
async function appendToSheet(values, sheetId) {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'Sheet1!A1',
      valueInputOption: 'USER_ENTERED',
      resource: { values: [values] },
    });
    return response.data;
  } catch (error) {
    console.error('Error appending to sheet:', error);
    throw error;
  }
}

// Function to get page access token and configure page
async function setupPage(pageId, sheetId) {
  try {
    const page = new Page(pageId);
    const pageAccessToken = await page.get(['access_token']);
    
    pageConfigs.set(pageId, {
      accessToken: pageAccessToken.access_token,
      sheetId: sheetId
    });
    
    return { success: true, message: 'Page configured successfully' };
  } catch (error) {
    console.error('Error setting up page:', error);
    throw error;
  }
}

// Function to fetch Facebook leads
async function getLeads(formId) {
  try {
    console.log('Fetching leads for form:', formId);
    const response = await axios.get(
      `https://graph.facebook.com/${FACEBOOK_API_VERSION}/${formId}/leads`,
      {
        params: {
          access_token: process.env.FACEBOOK_ACCESS_TOKEN,
          fields: 'id,created_time,field_data'
        }
      }
    );
    
    console.log('Leads fetched successfully:', response.data.data.length, 'leads found');
    return response.data.data;
  } catch (error) {
    console.error('Error fetching leads:', error);
    throw error;
  }
}

// Endpoint to list forms for a page
app.get('/page-forms/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    const response = await axios.get(
      `https://graph.facebook.com/${FACEBOOK_API_VERSION}/${pageId}/leadgen_forms`,
      {
        params: {
          access_token: process.env.FACEBOOK_ACCESS_TOKEN,
          fields: 'id,name,status,created_time'
        }
      }
    );
    res.json({ success: true, forms: response.data.data });
  } catch (error) {
    console.error('Error fetching page forms:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// Endpoint to get form details
app.get('/form-details/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    const response = await axios.get(
      `https://graph.facebook.com/${FACEBOOK_API_VERSION}/${formId}`,
      {
        params: {
          access_token: process.env.FACEBOOK_ACCESS_TOKEN,
          fields: 'id,name,page,status,created_time'
        }
      }
    );
    res.json({ success: true, form: response.data });
  } catch (error) {
    console.error('Error fetching form details:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// Endpoint to list all available pages
app.get('/list-pages', async (req, res) => {
  try {
    const pages = await getAllPages();
    // Format pages for better readability
    const formattedPages = pages.map(page => ({
      id: page.id,
      name: page.name,
      business: page.business_name || 'Direct Access'
    }));
    res.json({ 
      success: true, 
      total: formattedPages.length,
      pages: formattedPages 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to setup a new page configuration
app.post('/setup-page', async (req, res) => {
  try {
    const { pageId, sheetId } = req.body;
    if (!pageId || !sheetId) {
      return res.status(400).json({ success: false, error: 'Missing pageId or sheetId' });
    }

    const result = await setupPage(pageId, sheetId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to get leads
app.get('/form-leads/:formId', async (req, res) => {
  try {
    const { formId } = req.params;
    const leads = await getLeads(formId);
    res.json({ success: true, leads });
  } catch (error) {
    console.error('Error fetching leads:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data?.error?.message || error.message });
  }
});

// Endpoint to sync leads for a specific form
app.post('/sync-leads', async (req, res) => {
  try {
    const { formId, pageId } = req.body;
    if (!formId || !pageId) {
      return res.status(400).json({ success: false, error: 'Missing formId or pageId' });
    }

    // Get page configuration
    const pageConfig = pageToSheetMap.get(pageId);
    if (!pageConfig) {
      return res.status(400).json({ success: false, error: 'Page not configured. Please set up page-to-sheet mapping first.' });
    }

    const leads = await getLeads(formId);
    
    for (const lead of leads) {
      const leadData = [
        lead.id,
        lead.created_time,
        pageConfig.pageName || pageId,  // Add page name for reference
        ...Object.values(lead.field_data).map(field => field.value),
      ];
      await appendToSheet(leadData, pageConfig.sheetId);
    }

    // Update last sync time
    pageConfig.lastSync = new Date().toISOString();
    await saveMappings();

    res.json({ 
      success: true, 
      message: `Leads synced successfully to sheet ${pageConfig.sheetName}`,
      leadsCount: leads.length
    });
  } catch (error) {
    console.error('Error in sync:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to set up page-to-sheet mapping
app.post('/setup-mapping', async (req, res) => {
  try {
    const { pageId, pageName, sheetId, sheetName } = req.body;
    if (!pageId || !sheetId) {
      return res.status(400).json({ success: false, error: 'Missing pageId or sheetId' });
    }

    pageToSheetMap.set(pageId, {
      pageName,
      sheetId,
      sheetName: sheetName || 'Leads',
      lastSync: null
    });

    await saveMappings();
    res.json({ success: true, message: 'Mapping saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to get all mappings
app.get('/mappings', async (req, res) => {
  try {
    const mappings = Array.from(pageToSheetMap.entries()).map(([pageId, config]) => ({
      pageId,
      ...config
    }));
    res.json({ success: true, mappings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to delete mapping
app.delete('/mapping/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    if (pageToSheetMap.has(pageId)) {
      pageToSheetMap.delete(pageId);
      await saveMappings();
      res.json({ success: true, message: 'Mapping deleted successfully' });
    } else {
      res.status(404).json({ success: false, error: 'Mapping not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Load existing mappings when server starts
loadMappings().then(() => {
  // Start the server
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});
