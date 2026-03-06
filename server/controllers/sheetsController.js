const { GoogleSpreadsheet } = require('google-spreadsheet');

// Initialize Google Sheets connection
const initializeSheet = async () => {
  try {
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEETS_ID);

    // Set API key for read-only access
    if (process.env.GOOGLE_SHEETS_API_KEY) {
      doc.useApiKey(process.env.GOOGLE_SHEETS_API_KEY);
    }

    return doc;
  } catch (error) {
    console.error('Error initializing Google Sheets:', error);
    throw error;
  }
};

const getSheetData = async (req, res) => {
  try {
    const doc = await initializeSheet();

    // Load document properties and sheets
    await doc.loadInfo();

    // Get first sheet
    const sheet = doc.sheetsByIndex[0];
    if (!sheet) {
      return res.status(404).json({ message: 'No sheets found in the spreadsheet' });
    }

    // Get all rows
    const rows = await sheet.getRows();

    // Convert to JSON format
    const data = rows.map((row) => {
      const rowData = {};
      sheet.columnOrder.forEach((columnId) => {
        const column = sheet.columns.find((c) => c.id === columnId);
        if (column) {
          rowData[column.title] = row[column.title];
        }
      });
      return rowData;
    });

    res.json({
      message: 'Sheet data retrieved successfully',
      sheetTitle: sheet.title,
      recordCount: data.length,
      data: data,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch sheet data', error: error.message });
  }
};

const updateSheet = async (req, res) => {
  try {
    const { rowIndex, data } = req.body;

    if (!rowIndex || !data) {
      return res.status(400).json({ message: 'rowIndex and data are required' });
    }

    const doc = await initializeSheet();
    await doc.loadInfo();

    const sheet = doc.sheetsByIndex[0];
    if (!sheet) {
      return res.status(404).json({ message: 'No sheets found in the spreadsheet' });
    }

    const rows = await sheet.getRows();
    if (rowIndex >= rows.length) {
      return res.status(400).json({ message: 'Row index out of range' });
    }

    // Update row
    Object.keys(data).forEach((key) => {
      rows[rowIndex][key] = data[key];
    });

    await rows[rowIndex].save();

    res.json({
      message: 'Sheet data updated successfully',
      rowIndex: rowIndex,
      updatedData: data,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update sheet data', error: error.message });
  }
};

module.exports = {
  getSheetData,
  updateSheet,
};
