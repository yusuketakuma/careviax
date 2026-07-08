export type VisitVehicleResourceTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

export type VisitVehicleResourceSiteSummary = {
  id: string;
  name: string;
};

export type VisitVehicleResource = {
  id: string;
  site_id: string;
  label: string;
  vehicle_code: string | null;
  travel_mode: VisitVehicleResourceTravelMode;
  max_stops: number;
  max_route_duration_minutes: number | null;
  available: boolean;
  next_inspection_date: string | null;
  notes: string | null;
  site?: VisitVehicleResourceSiteSummary | null;
  created_at?: string;
  updated_at?: string;
};

export type VisitVehicleResourceSummary = {
  id: string;
  label: string;
  travel_mode: VisitVehicleResourceTravelMode;
  max_stops: number | null;
  max_route_duration_minutes: number | null;
};

export type VisitVehicleResourceScheduleOption = VisitVehicleResourceSummary & {
  available: boolean;
  site: VisitVehicleResourceSiteSummary | null;
};

export type VisitVehicleResourcesCountMeta = {
  total_count: number;
  visible_count: number;
  hidden_count: number;
  truncated: boolean;
  count_basis: 'visit_vehicle_resources';
  filters_applied: {
    site_id?: string;
    available?: boolean;
  };
  limit: number;
};

export type VisitVehicleResourcesResponse = {
  data: VisitVehicleResource[];
  meta: VisitVehicleResourcesCountMeta;
};

export type VisitVehicleResourceScheduleOptionsResponse = {
  data: VisitVehicleResourceScheduleOption[];
  meta: VisitVehicleResourcesCountMeta;
};
