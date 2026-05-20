import LeadsPage from "@/app/leads-page";

const NZ_CITIES = [
  "Auckland", "Wellington", "Christchurch", "Hamilton", "Tauranga",
  "Dunedin", "Palmerston North", "Nelson", "Rotorua", "New Plymouth",
];

export default function NZPage() {
  return (
    <LeadsPage
      title="Buyers Agent New Zealand 🇳🇿"
      csvFile="/leads_nz.csv"
      cities={NZ_CITIES}
      regionLabel="Region"
      businessIdLabel="NZBN"
      country="NZ"
      countryName="New Zealand"
    />
  );
}
