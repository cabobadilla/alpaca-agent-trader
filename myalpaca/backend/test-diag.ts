import 'dotenv/config';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import Alpaca from '@alpacahq/alpaca-trade-api';

async function main() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  console.log('Key:', key?.slice(0, 6));

  const alpaca = new Alpaca({ keyId: key!, secretKey: secret!, paper: true, feed: 'iex' });

  // Intercept Axios to see the real URL
  const axiosInst = (alpaca as any).axios ?? (alpaca as any).instance;
  if (axiosInst?.interceptors) {
    axiosInst.interceptors.request.use((config: any) => {
      console.log('SDK request URL:', config.baseURL, config.url);
      return config;
    });
  }

  try {
    const acct = await alpaca.getAccount();
    console.log('Account status:', acct.status);
  } catch (err: any) {
    console.log('Error:', err.message);
    console.log('Error code:', err.code ?? err.response?.status);
    console.log('Error cause:', err.cause?.message ?? 'none');
    if (err.response) {
      console.log('Response status:', err.response.status);
      console.log('Response data:', JSON.stringify(err.response.data).slice(0, 300));
    }
  }
}
main();
