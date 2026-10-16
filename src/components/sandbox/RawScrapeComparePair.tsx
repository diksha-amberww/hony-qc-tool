import { memo } from 'react'
import { Box } from '@mui/material'
import { RawAsinExtract } from './RawAsinExtract'
import { RawVendorWebsiteExtract } from './RawVendorWebsiteExtract'

export type RawScrapeComparePairProps = {
  /** Amazon / ASIN scrape payload */
  amazonData?: unknown
  /** Vendor website scrape payload */
  vendorData?: unknown
  asin?: string
  sku?: string
  maxHeight?: number | { xs?: number; md?: number; lg?: number }
  amazonEmptyMessage?: string
  vendorEmptyMessage?: string
  /** Hide the pair entirely when both sides are empty (default true). */
  hideWhenEmpty?: boolean
}

/**
 * Side-by-side Vendor + Amazon raw scrape panels (vendor left, Amazon right).
 * Reusable across Sandbox and Live Output SKU viewers.
 */
export const RawScrapeComparePair = memo(function RawScrapeComparePair({
  amazonData,
  vendorData,
  asin,
  sku,
  maxHeight = { xs: 220, lg: 260 },
  amazonEmptyMessage,
  vendorEmptyMessage,
  hideWhenEmpty = true,
}: RawScrapeComparePairProps) {
  if (hideWhenEmpty && amazonData == null && vendorData == null) return null

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' },
        gap: 1.5,
        alignItems: 'stretch',
        minWidth: 0,
      }}
    >
      <RawVendorWebsiteExtract
        data={vendorData}
        sku={sku}
        maxHeight={maxHeight}
        emptyMessage={vendorEmptyMessage}
      />
      <RawAsinExtract
        data={amazonData}
        asin={asin}
        maxHeight={maxHeight}
        emptyMessage={amazonEmptyMessage}
      />
    </Box>
  )
})
