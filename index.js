require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const userMap = new Map();

const app = express();

app.use(cors());
app.use(express.json());

// =========================
// EXNESS LOGIN DETAILS
// =========================

const EXNESS_LOGIN = process.env.EXNESS_LOGIN;
const EXNESS_PASSWORD = process.env.EXNESS_PASSWORD;

let EXNESS_TOKEN = null;

// =========================
// GET NEW TOKEN
// =========================

async function getToken() {

try {

    console.log("Getting new Exness token...");

    const response = await axios.post(
        "https://my.exnessaffiliates.com/api/auth/",
        {
    login: EXNESS_LOGIN,
    password: EXNESS_PASSWORD
}
    );

    EXNESS_TOKEN = response.data.token;

    console.log("Token refreshed successfully.");

    return EXNESS_TOKEN;

} catch (error) {

    console.log(
        "LOGIN ERROR:",
        error.response?.data || error.message
    );

    throw error;
}

}

// =========================
// AFFILIATION CHECK
// =========================

async function checkAffiliation(email) {

try {

    const response = await axios.post(
        "https://my.exnessaffiliates.com/api/partner/affiliation/",
        {
            email: email
        },
        {
            headers: {
                Authorization: `JWT ${EXNESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        }
    );

    return response.data;

} catch (error) {

    // Token expired?
    if (error.response && error.response.status === 401) {

        console.log("Token expired. Getting new token...");

        await getToken();

        const retry = await axios.post(
            "https://my.exnessaffiliates.com/api/partner/affiliation/",
            {
                email: email
            },
            {
                headers: {
                    Authorization: `JWT ${EXNESS_TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return retry.data;

    }

    throw error;

}


}

function isEligibleForVIP(clients) {

let eligible = [];

for (const client of clients) {

    const lots = Number(client.volume_lots || 0);
    const balance = Number(client.client_balance || 0);
    const volume = Number(client.volume_mln_usd || 0);
    const reward = Number(client.reward_usd || 0);

    // ❌ STRICT REJECTION RULE
    if (lots === 0 && balance === 0 && volume === 0) {
        continue;
    }

    // ✅ ACCEPT RULES (ANY OF THESE MAKES USER ELIGIBLE)
    if (
        lots > 0 ||
        balance > 0 ||
        volume > 0 ||
        reward > 0
    ) {
        eligible.push(client);
    }
}

return eligible;


}

// =========================
// QUALIFICATION ENGINE
// =========================

function evaluateClient(data) {

const clients = data?.data || [];


const eligibleClients = isEligibleForVIP(clients);

let activeClients = [];
let fundedOnly = [];
let inactive = [];

for (const client of clients) {

    const lots = Number(client.volume_lots || 0);
    const balance = Number(client.client_balance || 0);

    // 🔴 inactive
    if (lots === 0 && balance === 0) {
        inactive.push(client);
    }

    // 🟡 funded only
    else if (lots === 0 && balance > 0) {
        fundedOnly.push(client);
    }

    // 🟢 active trader
    else if (lots > 0) {
        activeClients.push(client);
    }
}

// Get the client's report
const client = clients[0];

if (!client) {
    return {
        category: "ERROR",
        message: "Client report not found."
    };
}

const lots = Number(client.volume_lots || 0);
const balance = Number(client.client_balance || 0);
const reward = Number(client.reward_usd || 0);
const volume = Number(client.volume_mln_usd || 0);

// ✅ Active trader
if (lots > 0) {
    return {
        category: "ACTIVE_CLIENT",
        message: "Trading activity confirmed. Welcome to VIP.",
        client: client
    };
}

// ✅ Funded account
if (balance > 0) {
    return {
        category: "FUNDED_ONLY",
        message: "Account funding confirmed. Welcome to VIP.",
        client: client
    };
}

// ✅ Reward received (extra safety)
if (reward > 0 || volume > 0) {
    return {
        category: "ACTIVE_CLIENT",
        message: "Trading activity confirmed. Welcome to VIP.",
        client: client
    };
}

// ❌ No funding or trading
return {
    category: "FUND_ACCOUNT",
    message: "Please fund your trading account and try again.",
    client: client
};
}

// =========================
// VERIFY ENDPOINT
// =========================

app.post("/verify", async (req, res) => {

const email = req.body.email;

if (!email) {
    return res.json({
        category: "ERROR",
        message: "Email required"
    });
}

try {

    // 1. Check affiliation
    const affiliation = await checkAffiliation(email);


console.log("AFFILIATION RESPONSE:", affiliation);

    if (!affiliation.affiliation) {
        return res.json({
            category: "NOT_ASSOCIATED",
            message: "Email not registered under partner link."
        });
    }

   const accounts = affiliation.accounts || [];

const client_uids = accounts
    .map(a => a.client_uid)
    .filter(Boolean);

// ✅ STORE USER MAPPING HERE
userMap.set(email, {
    accounts,
    client_uids
});

// If affiliated but there's no actual trading account under this email,
// there's nothing to report on — treat as "not funded/no activity yet".
if (client_uids.length === 0) {
    return res.json({
        category: "FUND_ACCOUNT",
        message: "Your account is associated with our partner link, but no trading account was found yet. Please fund/trade and try again."
    });
}

// 2. Get this client's report using the real short_client_uid
const reportResponse = await axios.get(
    "https://my.exnessaffiliates.com/api/v2/reports/clients/",
    {
        headers: {
            Authorization: `JWT ${EXNESS_TOKEN}`
        },
        params: {
            short_client_uid: client_uids[0]
        }
    }
);

console.log("REPORT RAW RESPONSE:", reportResponse.data);

    // 3. Evaluate client
    const result = evaluateClient(reportResponse.data);

    return res.json(result);

} catch (error) {

console.log("FULL VERIFY ERROR:");
console.log(error.response?.data);
console.log(error.response?.status);
console.log(error.message);

return res.json({
    category: "ERROR",
    message: error.response?.data || error.message
});


}

});

// =========================
// START SERVER
// =========================

app.listen(3000, async () => {

console.log("Verification Server V2 Running...");

try {

    await getToken();

    console.log("Current Token:");
    console.log(EXNESS_TOKEN);

} catch (err) {

    console.log("Unable to login.");

}


});
