import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const MAX_RECENT_PATIENTS = 8;

type PatientListState = {
  favoritePatientIds: string[];
  recentPatientIds: string[];
  toggleFavoritePatient: (patientId: string) => void;
  markRecentPatient: (patientId: string) => void;
};

export const usePatientListStore = create<PatientListState>()(
  persist(
    (set) => ({
      favoritePatientIds: [],
      recentPatientIds: [],
      toggleFavoritePatient: (patientId) =>
        set((state) => ({
          favoritePatientIds: state.favoritePatientIds.includes(patientId)
            ? state.favoritePatientIds.filter((id) => id !== patientId)
            : [patientId, ...state.favoritePatientIds],
        })),
      markRecentPatient: (patientId) =>
        set((state) => ({
          recentPatientIds: [patientId, ...state.recentPatientIds.filter((id) => id !== patientId)]
            .slice(0, MAX_RECENT_PATIENTS),
        })),
    }),
    {
      name: 'ph-os-patient-list',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
