import { BalanceResponse } from "@/types/balancer.types";

const BALANCER_API_URL = "http://localhost:8005";

export default class balancerService {
  static async balanceTeams(file: File): Promise<BalanceResponse> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${BALANCER_API_URL}/api/v1/balancer/balance`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to balance teams");
    }

    return response.json();
  }
}
