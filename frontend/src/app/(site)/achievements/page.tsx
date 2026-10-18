import { loadBrowsingDisciplineInit } from "@/lib/site/discipline-server";

import AchievementsCatalog from "./components/AchievementsCatalog";

// Dynamic by cookies: the saved game and the viewing scope decide what the first render resolves to.
const AchievementsPage = async () => <AchievementsCatalog initial={await loadBrowsingDisciplineInit()} />;

export default AchievementsPage;
