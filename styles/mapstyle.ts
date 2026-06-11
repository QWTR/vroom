import { Dimensions, StyleSheet } from 'react-native';
import { AppTheme } from '../constants/theme';

const { height } = Dimensions.get('window');

export function makeMapStyles(
  t: AppTheme,
  isDark = true,
  screenTopInset = 0,
  opts?: { mapControlsTop?: number },
) {
  const SURF  = t.surface;
  const SURF2 = t.surface2;
  const SURF3 = t.surface3;
  /** Odległość od góry *obszaru mapy* (wyszukiwarka, panel nawigacji). Gdy brak opts — jak dawniej: safe area + 12. */
  const MAP_CONTROLS_TOP = opts?.mapControlsTop ?? screenTopInset + 12;

  return StyleSheet.create({

    // ═══════════════════════════════════════════
    // CONTAINERS
    // ═══════════════════════════════════════════
    container:    { flex: 1, backgroundColor: t.bg },
    mapContainer: { flex: 1, position: 'relative' },
    map:          { width: '100%', height: '100%' },
    loader: {
      flex: 1, justifyContent: 'center', alignItems: 'center',
      backgroundColor: t.bg, gap: 12,
    },
    loaderText: {
      color: t.primary, fontFamily: 'Orbitron',
      fontSize: 11, letterSpacing: 4, marginTop: 4,
    },

    // ═══════════════════════════════════════════
    // MARKERS
    // ═══════════════════════════════════════════
    carMarker: {
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: SURF, borderWidth: 2, borderColor: t.primaryBorder,
      justifyContent: 'center', alignItems: 'center',
      shadowColor: t.primary, shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.5, shadowRadius: 6, elevation: 8,
    },
    userCarMarkerContainer: { alignItems: 'center', justifyContent: 'center', paddingBottom: 4 },
    userCarMarkerLabel: {
      color: t.mapLabelText, fontSize: 9, fontFamily: 'Orbitron', letterSpacing: 0.5,
      backgroundColor: t.mapLabelBg, paddingHorizontal: 7, paddingVertical: 3,
      borderRadius: 6, overflow: 'hidden', marginBottom: 2, textAlign: 'center',
      borderWidth: 1, borderColor: t.border2,
    },
    userCarMarkerDistance: {
      color: t.primary, fontSize: 8, fontFamily: 'Orbitron',
      backgroundColor: t.mapLabelBg, paddingHorizontal: 5, paddingVertical: 2,
      borderRadius: 4, overflow: 'hidden', marginBottom: 4, textAlign: 'center',
    },
    userCarMarker: {
      width: 38, height: 38, borderRadius: 10,
      justifyContent: 'center', alignItems: 'center',
      borderWidth: 1, borderColor: t.primaryBorder, backgroundColor: t.primaryBg,
      shadowColor: t.primary, shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.4, shadowRadius: 4, elevation: 6,
    },
    userMarker: {
      paddingHorizontal: 10, paddingVertical: 8,
      backgroundColor: SURF, borderRadius: 12,
      borderWidth: 1, borderColor: t.primaryBorder,
      alignItems: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.5, shadowRadius: 4, elevation: 6,
    },
    userMarkerText:     { fontSize: 18, marginBottom: 2 },
    userMarkerName:     { fontSize: 8, color: t.text, fontFamily: 'Orbitron', letterSpacing: 0.5 },
    userMarkerDistance: { fontSize: 7, color: t.primary, fontFamily: 'Orbitron', letterSpacing: 0.5, marginTop: 2 },

    // ═══════════════════════════════════════════
    // HUD — premium driving / navigation overlay
    // ═══════════════════════════════════════════
    /** Lewy margines + warunkowy `top` ustawiany w map.tsx (nawigacja vs swobodna jazda). */
    hudSpeedTilePos: {
      position: 'absolute',
      left: 16,
      zIndex: 95,
      backgroundColor: 'transparent',
      alignItems: 'flex-start',
      pointerEvents: 'box-none',
    },
    /** Nawigacja — pod panelem instrukcji skrętu. */
    hudSpeedTilePosNav: {
      top: 188,
    },
    /** Swobodna jazda — tuż pod paskiem wyszukiwania (wyżej niż przy nawigacji). */
    hudSpeedTilePosFreeDrive: {
      top: 160,
    },
    /** Pod czerwonym banerem trybu tworzenia trasy. */
    hudSpeedTilePosBuilding: {
      top: 56,
    },
    hudOffRouteBanner: {
      position: 'absolute',
      left: 12,
      right: 12,
      zIndex: 20,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: t.warning + '55',
      backgroundColor: SURF,
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 10,
    },
    hudOffRouteText: {
      fontSize: 13,
      fontWeight: '700',
      color: t.warning,
      flex: 1,
    },

    // ═══════════════════════════════════════════
    // SIDE CONTROLS
    // ═══════════════════════════════════════════
    /** bottom nadpisywany w map.tsx: insets.bottom + 80 (nad tab barem). */
    rightBottomControls: {
      position: 'absolute',
      right: 14,
      bottom: 16,
      gap: 10,
      zIndex: 100,
    },
    sideBtn: {
      backgroundColor: SURF,
      width: 48,
      height: 48,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    /** Spójny wygląd ikon w rozwiniętym menu FAB (bez tęczowych obramowań). */
    fabSheetItem: {
      borderColor: t.border2,
      backgroundColor: isDark ? t.surface2 : t.surface,
    },

    // ═══════════════════════════════════════════
    // TOP SEARCH BAR
    // ═══════════════════════════════════════════
    topSearchButton: {
      position: 'absolute',
      top: MAP_CONTROLS_TOP,
      left: 12,
      right: 12,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? SURF : t.mapOverlay,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 13,
      borderWidth: isDark ? 1 : 1.5,
      borderColor: isDark ? t.border2 : t.border2,
      elevation: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: isDark ? 0.4 : 0.15,
      shadowRadius: 8,
      zIndex: 10,
    },
    topSearchButtonText: {
      color: t.textDim, fontSize: 11, fontFamily: 'Orbitron',
      letterSpacing: 1, flex: 1, marginHorizontal: 10,
    },

    // ═══════════════════════════════════════════
    // NAVIGATION PANEL TOP (legacy keys — HUD używa HudPanelShell)
    // ═══════════════════════════════════════════
    navigationPanelTop: {
      position: 'absolute',
      top: MAP_CONTROLS_TOP,
      left: 12,
      right: 12,
      zIndex: 13,
    },
    instructionBox: { paddingRight: 44 },
    instructionDistance: {
      fontFamily: 'Orbitron',
      fontSize: 26,
      fontWeight: '900',
      color: t.text,
      letterSpacing: -0.5,
      lineHeight: 30,
    },
    instructionText: {
      color: t.text,
      fontSize: 14,
      fontWeight: '600',
      lineHeight: 20,
    },
    stepCounter: {
      color: t.textMuted,
      fontSize: 12,
      fontWeight: '600',
      marginTop: 8,
    },
    closeNavBtn: {
      position: 'absolute',
      top: 10,
      right: 10,
      width: 32,
      height: 32,
      borderRadius: 10,
      backgroundColor: SURF2,
      borderWidth: 1,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ═══════════════════════════════════════════
    // BOTTOM SHEET
    // ═══════════════════════════════════════════
    bottomSheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: isDark ? SURF : t.mapOverlay,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderTopWidth: isDark ? 1 : 1.5,
      borderLeftWidth: isDark ? 1 : 1.5,
      borderRightWidth: isDark ? 1 : 1.5,
      borderColor: isDark ? t.border2 : t.border2,
      elevation: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: isDark ? 0.3 : 0.1,
      shadowRadius: 12,
      paddingBottom: 32,
    },
    expandHandle: {
      width: 40, height: 3, backgroundColor: t.border3,
      borderRadius: 2, alignSelf: 'center', marginTop: 14, marginBottom: 16,
    },
    infoPreview: { paddingHorizontal: 16 },

    routeInfoCard: {
      backgroundColor: SURF2, borderRadius: 16,
      borderWidth: 1, borderColor: t.border, marginBottom: 10, overflow: 'hidden',
    },
    routeInfoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
    routeInfoLocation: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    routeInfoDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.textDim },
    routeInfoLocationName: { color: t.textMuted, fontSize: 10, fontFamily: 'Orbitron', letterSpacing: 0.5, flex: 1 },
    routeInfoDivider: { height: 1, backgroundColor: t.border, marginHorizontal: 16 },

    routeStatsRow: {
      flexDirection: 'row', backgroundColor: SURF2, borderRadius: 16,
      borderWidth: 1, borderColor: t.border, marginBottom: 12, overflow: 'hidden',
    },
    statItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14 },
    statIcon: { backgroundColor: t.primaryBg, padding: 7, borderRadius: 10, borderWidth: 1, borderColor: t.primaryBorder },
    statLabel: { color: t.textDim, fontSize: 7, fontFamily: 'Orbitron', letterSpacing: 2, marginBottom: 4 },
    statValue: { color: t.text, fontSize: 15, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: -0.5 },
    statDivider: { width: 1, backgroundColor: t.border, marginVertical: 10 },

    bottomSheetButtons: { flexDirection: 'row', gap: 8 },
    navigateButton: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, paddingVertical: 15, backgroundColor: t.primary,
      borderRadius: 14, borderWidth: 1, borderColor: t.primaryBorder,
      elevation: 4, shadowColor: t.primary,
      shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6,
    },
    navigateButtonText: { color: t.onPrimary, fontSize: 10, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 1.5 },
    editButton: {
      width: 50, height: 50, alignItems: 'center', justifyContent: 'center',
      backgroundColor: SURF2, borderRadius: 14, borderWidth: 1, borderColor: t.primaryBorder,
    },
    resetButtonSmall: {
      width: 50, height: 50, justifyContent: 'center', alignItems: 'center',
      backgroundColor: SURF2, borderRadius: 14, borderWidth: 1, borderColor: t.border2,
    },

    // ═══════════════════════════════════════════
    // EMPTY STATE
    // ═══════════════════════════════════════════
    emptyStateContainer: {
      position: 'absolute',
      bottom: -5,
      left: 0,
      right: 0,
      height: 170,
      backgroundColor: isDark ? SURF : t.mapOverlay,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderTopWidth: isDark ? 1 : 1.5,
      borderColor: isDark ? t.border2 : t.border2,
      justifyContent: 'center',
      alignItems: 'center',
      paddingBottom: 24,
    },
    emptyState:    { alignItems: 'center', gap: 10 },
    emptyTitle:    { color: t.text, fontSize: 12, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 3 },
    emptySubtitle: { color: t.textDim, fontSize: 8, fontFamily: 'Orbitron', letterSpacing: 1.5, textAlign: 'center', marginHorizontal: 24 },

    // ═══════════════════════════════════════════
    // SEARCH MODAL
    // ═══════════════════════════════════════════
    searchModalOverlay:   { flex: 1, backgroundColor: 'transparent' },
    searchModalBackdrop:  { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.overlay },
    searchModalContainer: {
      position: 'absolute', top: 0, left: 0, right: 0,
      maxHeight: height * 0.92, backgroundColor: SURF,
      borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
      borderBottomWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
      borderColor: t.border2,
      paddingTop: screenTopInset + 20,
      elevation: 20, shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 12,
      zIndex: 12,
    },
    searchModalHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 20, gap: 12 },
    searchModalBackBtn: {
      width: 38, height: 38, backgroundColor: SURF2, borderRadius: 12,
      borderWidth: 1, borderColor: t.border2, alignItems: 'center', justifyContent: 'center',
    },
    searchModalTitle: { color: t.text, fontSize: 18, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 1, flex: 1 },
    searchModalTabs:  { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 16 },
    searchModalTab: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 11, borderRadius: 12, backgroundColor: SURF2, borderWidth: 1, borderColor: t.border,
    },
    searchModalTabActive:     { backgroundColor: t.primaryBg, borderColor: t.primaryBorder },
    searchModalTabText:       { color: t.textDim, fontSize: 9, fontFamily: 'Orbitron', letterSpacing: 1 },
    searchModalTabTextActive: { color: t.primary, fontFamily: 'Orbitron', letterSpacing: 1 },
    searchModalDivider:       { height: 1, backgroundColor: t.border, marginHorizontal: 16, marginBottom: 16 },
    searchModalInputContainer: {
      flexDirection: 'row', alignItems: 'center',
      marginHorizontal: 16, marginBottom: 14,
      backgroundColor: SURF2, borderRadius: 14,
      borderWidth: 1, borderColor: t.border2,
      paddingHorizontal: 14, paddingVertical: 12, gap: 10,
    },
    searchModalInput:  { flex: 1, color: t.text, fontSize: 12, fontFamily: 'Orbitron', paddingVertical: 0, letterSpacing: 0.5 },
    searchHelperText:  { color: t.textDim, fontSize: 8, fontFamily: 'Orbitron', letterSpacing: 2, marginHorizontal: 16, marginBottom: 14 },
    searchResultsList: {
      marginHorizontal: 16, marginBottom: 16, maxHeight: height * 0.55,
      borderRadius: 16, backgroundColor: SURF2, borderWidth: 1, borderColor: t.border, overflow: 'hidden',
    },
    searchResultItem: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 14, paddingVertical: 14, gap: 12,
      borderBottomWidth: 1, borderBottomColor: t.border,
    },
    searchResultIconCurrent: { width: 42, height: 42, borderRadius: 12, backgroundColor: t.primaryBg, borderWidth: 1, borderColor: t.primaryBorder, justifyContent: 'center', alignItems: 'center' },
    searchResultIconUser:    { width: 42, height: 42, borderRadius: 12, backgroundColor: SURF3, borderWidth: 1, borderColor: t.border2, justifyContent: 'center', alignItems: 'center' },
    searchResultIconPlace:   { width: 42, height: 42, borderRadius: 12, backgroundColor: SURF3, borderWidth: 1, borderColor: t.border2, justifyContent: 'center', alignItems: 'center' },
    searchResultUserAvatar:  { fontSize: 20 },
    searchResultItemText:    { color: t.text, fontSize: 12, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 0.2 },
    searchResultMeta:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
    userStatusDot:           { width: 6, height: 6, borderRadius: 3 },
    searchResultMetaText:    { color: t.textDim, fontSize: 8, fontFamily: 'Orbitron', letterSpacing: 0.5 },

    categoriesGrid:       { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
    categoryCard:         { backgroundColor: SURF2, borderRadius: 16, borderWidth: 1, borderColor: t.border, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
    categoryIconContainer:{ width: 52, height: 52, borderRadius: 14, backgroundColor: t.primaryBg, borderWidth: 1, borderColor: t.primaryBorder, justifyContent: 'center', alignItems: 'center' },
    categoryTitle:        { color: t.text, fontSize: 12, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 0.3, marginBottom: 3 },
    categorySubtitle:     { color: t.textDim, fontSize: 8, fontFamily: 'Orbitron', letterSpacing: 1 },
    emptyList:            { justifyContent: 'center', alignItems: 'center', paddingVertical: 48, gap: 12 },
    emptyListText:        { color: t.textDim, fontSize: 9, fontFamily: 'Orbitron', letterSpacing: 2 },

    // ═══════════════════════════════════════════
    // USER INFO MODAL
    // ═══════════════════════════════════════════
    userInfoOverlay:  { flex: 1, backgroundColor: 'transparent' },
    userInfoBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.overlay },
    userInfoCard: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: SURF,
      borderTopLeftRadius: 28, borderTopRightRadius: 28,
      borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
      borderColor: t.border2, paddingTop: 8, paddingBottom: 32, paddingHorizontal: 20,
      elevation: 20, shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.3, shadowRadius: 12,
    },
    userInfoHandle:      { width: 40, height: 3, backgroundColor: t.border3, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
    userInfoHeader:      { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 16 },
    userInfoAvatarWrap:  { width: 64, height: 64, borderRadius: 20, backgroundColor: t.primaryBg, borderWidth: 1, borderColor: t.primaryBorder, alignItems: 'center', justifyContent: 'center' },
    userInfoAvatar:      { fontSize: 36 },
    userInfoHeaderText:  { flex: 1, gap: 6 },
    userInfoCloseBtn:    { width: 36, height: 36, backgroundColor: t.border, borderRadius: 10, borderWidth: 1, borderColor: t.border2, alignItems: 'center', justifyContent: 'center' },
    userInfoContent:     { marginBottom: 20 },
    userInfoName:        { color: t.text, fontSize: 20, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 0.5 },
    userInfoStatusRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
    userInfoStatusDot:   { width: 7, height: 7, borderRadius: 4 },
    userInfoStatus:      { color: t.textDim, fontSize: 8, fontFamily: 'Orbitron', letterSpacing: 2 },
    userInfoDivider:     { height: 1, backgroundColor: t.border, marginBottom: 16 },
    userInfoStatsRow:    { flexDirection: 'row', gap: 8, marginBottom: 16 },
    userInfoStatCard:    { flex: 1, backgroundColor: SURF2, borderRadius: 14, borderWidth: 1, borderColor: t.border, padding: 14, gap: 6 },
    userInfoStatRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
    userInfoStatIcon:    { width: 32, height: 32, borderRadius: 8, backgroundColor: t.primaryBg, borderWidth: 1, borderColor: t.primaryBorder, justifyContent: 'center', alignItems: 'center' },
    userInfoStatLabel:   { color: t.textDim, fontSize: 7, fontFamily: 'Orbitron', letterSpacing: 2, marginBottom: 2 },
    userInfoStatValue:   { color: t.text, fontSize: 16, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: -0.5 },
    userInfoBadge:       { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#ff6b9d15', borderRadius: 20, borderWidth: 1, borderColor: '#ff6b9d35', marginBottom: 16 },
    userInfoBadgeText:   { color: '#ff6b9d', fontSize: 8, fontFamily: 'Orbitron', letterSpacing: 1.5 },
    userInfoNavigateBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 15, backgroundColor: t.primary, borderRadius: 14, borderWidth: 1, borderColor: t.primaryBorder, elevation: 4, shadowColor: t.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6 },
    userInfoNavigateBtnText: { color: t.onPrimary, fontSize: 10, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 2 },

    // ═══════════════════════════════════════════
    // DRAWER / SETTINGS MODAL
    // ═══════════════════════════════════════════
    drawerModalContainer: { flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
    drawerModal:          { backgroundColor: SURF, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderTopWidth: 1, borderTopColor: t.border2, padding: 24, paddingBottom: 40 },
    drawerHandle:         { width: 40, height: 3, backgroundColor: t.border3, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
    drawerTitle:          { color: t.text, fontFamily: 'Orbitron', fontWeight: '700', fontSize: 13, letterSpacing: 4, marginBottom: 20 },
    drawerBtn:            { paddingVertical: 15, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 14, backgroundColor: SURF2, marginBottom: 8, borderWidth: 1, borderColor: t.border },
    drawerBtnActive:      { backgroundColor: t.primaryBg, borderColor: t.primaryBorder },
    drawerBtnIcon:        { width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: t.textDim, justifyContent: 'center', alignItems: 'center' },
    drawerBtnIconInner:   { width: 9, height: 9, borderRadius: 2, backgroundColor: t.text },
    drawerBtnTxt:         { color: t.textMuted, fontSize: 10, fontFamily: 'Orbitron', letterSpacing: 1.5, flex: 1 },
    drawerBtnTxtActive:   { color: t.primary },
    drawerCloseBtn:       { position: 'absolute', top: 20, right: 20, padding: 8, backgroundColor: t.border, borderRadius: 12, borderWidth: 1, borderColor: t.border2, zIndex: 15 },
    drawerDivider:        { height: 1, backgroundColor: t.border, marginVertical: 14 },
    drawerSectionLabel:   { color: t.textDim, fontSize: 7, fontFamily: 'Orbitron', letterSpacing: 3, marginBottom: 10 },

    // ════════════════════════���══════════════════
    // REPORT MODAL
    // ═══════════════════════════════════════════
    reportItem:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16, backgroundColor: SURF2, borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: t.border, gap: 14 },
    reportIconWrap:  { width: 44, height: 44, borderRadius: 12, backgroundColor: t.border, borderWidth: 1, borderColor: t.border2, alignItems: 'center', justifyContent: 'center' },
    reportItemText:  { color: t.text, fontSize: 11, fontFamily: 'Orbitron', fontWeight: '700', letterSpacing: 0.5, flex: 1 },
    reportItemArrow: { opacity: 0.4 },
  });
}