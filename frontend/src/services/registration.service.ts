import { apiFetch } from "@/lib/api-fetch";
import type {
  Registration,
  RegistrationCreateInput,
  RegistrationForm,
  RegistrationUpdateInput,
} from "@/types/registration.types";

const registrationService = {
  async getForm(
    workspaceId: number,
    tournamentId: number,
  ): Promise<RegistrationForm | null> {
    const response = await apiFetch(
      "app",
      `workspaces/${workspaceId}/tournaments/${tournamentId}/registration/form`,
    );
    return response.json();
  },

  async register(
    workspaceId: number,
    tournamentId: number,
    input: RegistrationCreateInput,
  ): Promise<Registration> {
    const response = await apiFetch(
      "app",
      `workspaces/${workspaceId}/tournaments/${tournamentId}/registration`,
      { method: "POST", body: input },
    );
    return response.json();
  },

  async getMyRegistration(
    workspaceId: number,
    tournamentId: number,
  ): Promise<Registration | null> {
    const response = await apiFetch(
      "app",
      `workspaces/${workspaceId}/tournaments/${tournamentId}/registration/me`,
    );
    return response.json();
  },

  async updateMyRegistration(
    workspaceId: number,
    tournamentId: number,
    input: RegistrationUpdateInput,
  ): Promise<Registration> {
    const response = await apiFetch(
      "app",
      `workspaces/${workspaceId}/tournaments/${tournamentId}/registration/me`,
      { method: "PATCH", body: input },
    );
    return response.json();
  },

  async withdrawMyRegistration(
    workspaceId: number,
    tournamentId: number,
  ): Promise<void> {
    await apiFetch(
      "app",
      `workspaces/${workspaceId}/tournaments/${tournamentId}/registration/me`,
      { method: "DELETE" },
    );
  },

  async checkInMyRegistration(
    workspaceId: number,
    tournamentId: number,
  ): Promise<Registration> {
    const response = await apiFetch(
      "app",
      `workspaces/${workspaceId}/tournaments/${tournamentId}/registration/me/check-in`,
      { method: "POST" },
    );
    return response.json();
  },

  async listRegistrations(
    workspaceId: number,
    tournamentId: number,
  ): Promise<Registration[]> {
    const response = await apiFetch(
      "app",
      `workspaces/${workspaceId}/tournaments/${tournamentId}/registration/list`,
    );
    return response.json();
  },
};

export default registrationService;
