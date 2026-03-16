const AIRTABLE_API_KEY = "PASTE_API_KEY_HERE";
const BASE_ID = "PASTE_BASE_ID_HERE";
const TABLE_NAME = "Rooms";

async function loadRoomData() {
  const slug = window.location.pathname.split("/").pop();

  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}?filterByFormula={QR Slug}='${slug}'`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`
    }
  });

  const data = await response.json();

  if (!data.records.length) return;

  const room = data.records[0].fields;

  document.getElementById("roomNumber").textContent = room["Room Number"];
  document.getElementById("inspector").textContent = room["Latest Inspector"];
  document.getElementById("date").textContent = room["Latest Inspection Date"];
  document.getElementById("tier").textContent = room["Latest Certification Tier"];
  document.getElementById("recordID").textContent = room["Latest Verification Record ID"];
}

loadRoomData();
