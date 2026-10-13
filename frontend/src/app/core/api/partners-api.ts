import { httpResource } from '@angular/common/http';
import { Service } from '@angular/core';
import { apiRequest } from './request';
import type {
  ComparisonCell,
  FilterParams,
  PartnerDay,
  PartnerPage,
  PartnerQuery,
  PartnerSummary,
} from './types';

export interface PartnerRequest {
  partnerId: string;
  filters: FilterParams;
}

/** Partner endpoints. See AnalyticsApi for how the resources refetch. */
@Service()
export class PartnersApi {
  list(query: () => PartnerQuery | undefined) {
    return httpResource<PartnerPage>(() => apiRequest('/api/partners', query()));
  }

  partner(request: () => PartnerRequest | undefined) {
    return httpResource<PartnerSummary>(() => partnerRequest(request(), ''));
  }

  comparison(request: () => PartnerRequest | undefined) {
    return httpResource<ComparisonCell[]>(() => partnerRequest(request(), '/comparison'));
  }

  daily(request: () => PartnerRequest | undefined) {
    return httpResource<PartnerDay[]>(() => partnerRequest(request(), '/daily'));
  }
}

function partnerRequest(request: PartnerRequest | undefined, suffix: string) {
  if (!request) return undefined;
  const url = `/api/partners/${encodeURIComponent(request.partnerId)}${suffix}`;
  return apiRequest(url, request.filters);
}
