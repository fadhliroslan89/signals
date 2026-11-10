// Integration-test only: simulate exchange outage without touching production configuration.
global.fetch = async function () { throw new Error('simulated KuCoin connection failure'); };
