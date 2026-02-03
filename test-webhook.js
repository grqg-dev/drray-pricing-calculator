// Test script to send sample payload with name field to webhook

const WEBHOOK_URL = 'https://hook.us2.make.com/5xso5d5tyu3ubbz45isvoohto6jx1mfo';

// Sample payload matching the current structure with name field added
const samplePayload = {
  name: 'John Doe', // New field
  totalPrice: 8500,
  deposit: 850,
  monthlyPayment: 1275,
  months: 6,
  payoffDate: new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000).toISOString(), // 6 months from now
  dueDate: null,
  isSlidingScale: false,
  originalPrice: null,
  isExtended: false,
  timestamp: new Date().toISOString(),
  depositPercent: 0.10,
  customDeposit: null
};

async function testWebhook() {
  try {
    console.log('Sending test payload to webhook...');
    console.log('Payload:', JSON.stringify(samplePayload, null, 2));
    
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(samplePayload),
    });

    console.log('\nResponse Status:', response.status, response.statusText);
    
    const responseText = await response.text();
    console.log('Response Body:', responseText);
    
    if (response.ok) {
      console.log('\n✓ Webhook test successful!');
    } else {
      console.log('\n✗ Webhook test failed');
    }
  } catch (error) {
    console.error('Error sending webhook:', error);
  }
}

testWebhook();
