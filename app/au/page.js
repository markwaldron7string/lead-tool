import LeadsPage from "@/app/leads-page";

const AU_CITIES = [
  "Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide",
  "Canberra", "Darwin", "Hobart", "Gold Coast", "Newcastle",
  "Wollongong", "Geelong",
];

export default function AUPage() {
  return (
    <LeadsPage
      title="Buyers Agent Australia 🇦🇺"
      csvFile="/leads.csv"
      cities={AU_CITIES}
      regionLabel="State"
      businessIdLabel="ABN"
      country="AU"
      countryName="Australia"
    />
  );
}
