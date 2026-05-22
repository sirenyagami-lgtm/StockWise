(function () {
    const chartRegistry = {};

    let activeHelpPopover = null;
    let activeHelpModal = null;
    let activeNavigationController = null;
    let navigationRequestId = 0;
    let pageEnterTransitionTimeout = null;

    const PAGE_STATE_PREFIX = "stockwise:page-state:";
    const boundHandlerRegistry = new WeakMap();

    function readPageState(key) {
        try {
            const raw = window.sessionStorage?.getItem(`${PAGE_STATE_PREFIX}${key}`);
            return raw ? JSON.parse(raw) : {};
        } catch (error) {
            return {};
        }
    }

    function writePageState(key, value) {
        try {
            const current = readPageState(key);
            const next = Object.assign({}, current, value || {});
            window.sessionStorage?.setItem(`${PAGE_STATE_PREFIX}${key}`, JSON.stringify(next));
            return next;
        } catch (error) {
            return value || {};
        }
    }


    function clearStockWisePageStates() {
        try {
            const storage = window.sessionStorage;
            if (!storage) return;

            const keysToRemove = [];
            for (let index = 0; index < storage.length; index += 1) {
                const key = storage.key(index);
                if (key && key.startsWith(PAGE_STATE_PREFIX)) {
                    keysToRemove.push(key);
                }
            }

            keysToRemove.forEach((key) => storage.removeItem(key));
        } catch (error) {
            // Ignore storage errors in private or restricted browser contexts.
        }
    }

    function datasetKey(value) {
        return String(value || '')
            .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
            .replace(/^[^a-zA-Z]+/, '')
            || 'stockwiseBound';
    }

    function bindOnce(element, eventName, namespace, handler, options) {
        if (!element || typeof element.addEventListener !== "function") return;

        const key = datasetKey(`bound-${namespace}-${eventName}`);

        if (element.dataset) {
            if (element.dataset[key] === "true") return;
            element.dataset[key] = "true";
            element.addEventListener(eventName, handler, options);
            return;
        }

        let boundSet = boundHandlerRegistry.get(element);
        if (!boundSet) {
            boundSet = new Set();
            boundHandlerRegistry.set(element, boundSet);
        }

        if (boundSet.has(key)) return;
        boundSet.add(key);
        element.addEventListener(eventName, handler, options);
    }

    function closeTopbarPanel(panel) {
        if (!panel) return;

        if (panel.__stockwiseCloseTimer) {
            window.clearTimeout(panel.__stockwiseCloseTimer);
            panel.__stockwiseCloseTimer = null;
        }

        if (panel.classList.contains("open")) {
            panel.classList.add("is-closing");
        }

        panel.classList.remove("open");
        panel.setAttribute("aria-hidden", "true");

        const trigger = document.querySelector(`[aria-controls="${panel.id}"]`);
        if (trigger) trigger.setAttribute("aria-expanded", "false");

        panel.__stockwiseCloseTimer = window.setTimeout(() => {
            panel.classList.remove("is-closing");
            panel.__stockwiseCloseTimer = null;
        }, 180);
    }

    function closeTopbarDropdowns(exceptId = "") {
        document.querySelectorAll(".topbar-dropdown-panel.open").forEach((panel) => {
            if (panel.id !== exceptId) closeTopbarPanel(panel);
        });
    }

    function setNavigationLoadingVisible(isVisible) {
        let indicator = document.querySelector('[data-navigation-loading]');
        if (!indicator && !isVisible) return;
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'navigation-loading-pill';
            indicator.dataset.navigationLoading = 'true';
            indicator.textContent = 'Loading store data...';
            document.body.appendChild(indicator);
        }
        indicator.classList.toggle('is-visible', !!isVisible);
    }

    function getPageKeyFromUrl(value) {
        try {
            const url = new URL(value || window.location.href, window.location.origin);
            const path = url.pathname;
            if (path === "/activity_logs") return "activity_logs";
            if (path === "/data_management") return "data_management";
            if (path === "/team_access") return "team_access";
            return normalizeNavPath(path);
        } catch (error) {
            return getCurrentPageKey(document);
        }
    }

    let logoutConfirmTargetHref = '/logout';

    function getLogoutConfirmationElements() {
        const overlay = document.getElementById('logoutConfirmOverlay');
        return {
            overlay,
            confirmLink: overlay?.querySelector('[data-logout-confirm]') || null,
            cancelButton: overlay?.querySelector('[data-logout-cancel]') || null,
        };
    }

    function openLogoutConfirmation(href) {
        const { overlay, confirmLink, cancelButton } = getLogoutConfirmationElements();
        if (!overlay) return false;

        logoutConfirmTargetHref = href || logoutConfirmTargetHref || '/logout';
        if (confirmLink) confirmLink.setAttribute('href', logoutConfirmTargetHref);

        overlay.hidden = false;
        requestAnimationFrame(() => overlay.classList.add('is-visible'));
        closeTopbarDropdowns();
        cancelButton?.focus();
        return true;
    }

    function closeLogoutConfirmation() {
        const { overlay } = getLogoutConfirmationElements();
        if (!overlay) return;

        overlay.classList.remove('is-visible');
        window.setTimeout(() => {
            if (!overlay.classList.contains('is-visible')) overlay.hidden = true;
        }, 180);
    }

    function showStockWiseConfirm({
        title = 'Confirm action',
        message = '',
        confirmLabel = 'Continue',
        cancelLabel = 'Cancel',
        danger = false,
    } = {}) {
        return new Promise((resolve) => {
            let overlay = document.getElementById('stockwiseConfirmOverlay');

            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'stockwiseConfirmOverlay';
                overlay.className = 'logout-confirm-overlay stockwise-confirm-overlay';
                overlay.hidden = true;
                overlay.innerHTML = `
                    <div class="logout-confirm-modal stockwise-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="stockwiseConfirmTitle">
                        <h3 id="stockwiseConfirmTitle" data-confirm-title></h3>
                        <p data-confirm-message></p>
                        <div class="logout-confirm-actions">
                            <button type="button" class="btn btn-outline" data-confirm-cancel></button>
                            <button type="button" class="btn btn-yellow" data-confirm-ok></button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);
            }

            const titleEl = overlay.querySelector('[data-confirm-title]');
            const messageEl = overlay.querySelector('[data-confirm-message]');
            const cancelButton = overlay.querySelector('[data-confirm-cancel]');
            const confirmButton = overlay.querySelector('[data-confirm-ok]');

            if (!(titleEl && messageEl && cancelButton && confirmButton)) {
                resolve(false);
                return;
            }

            titleEl.textContent = title;
            messageEl.textContent = message;
            cancelButton.textContent = cancelLabel;
            confirmButton.textContent = confirmLabel;
            confirmButton.classList.toggle('danger', danger);

            const cleanup = () => {
                cancelButton.removeEventListener('click', onCancel);
                confirmButton.removeEventListener('click', onConfirm);
                overlay.removeEventListener('click', onOverlayClick);
                document.removeEventListener('keydown', onKeydown);
            };

            const close = (value) => {
                overlay.classList.remove('is-visible');
                window.setTimeout(() => {
                    overlay.hidden = true;
                    cleanup();
                    resolve(value);
                }, 180);
            };

            const onCancel = () => close(false);
            const onConfirm = () => close(true);
            const onOverlayClick = (event) => {
                if (event.target === overlay) close(false);
            };
            const onKeydown = (event) => {
                if (event.key === 'Escape') close(false);
            };

            cancelButton.addEventListener('click', onCancel);
            confirmButton.addEventListener('click', onConfirm);
            overlay.addEventListener('click', onOverlayClick);
            document.addEventListener('keydown', onKeydown);

            overlay.hidden = false;
            requestAnimationFrame(() => overlay.classList.add('is-visible'));
            cancelButton.focus();
        });
    }

    function initializeTopbarDropdowns(root = document) {
        const topbar = document.querySelector('[data-persistent-topbar]');
        if (!topbar || topbar.dataset.dropdownBound === 'true') return;
        topbar.dataset.dropdownBound = 'true';

        const notificationToggle = topbar.querySelector('#notificationToggle');
        const notificationDropdown = topbar.querySelector('#notificationDropdown');
        const accountToggle = topbar.querySelector('#accountToggle');
        const accountDropdown = topbar.querySelector('#accountDropdown');
        const notificationTabs = Array.from(topbar.querySelectorAll('[data-notification-tab]'));
        const notificationItems = Array.from(topbar.querySelectorAll('[data-notification-item]'));
        const notificationEmpty = topbar.querySelector('[data-notification-empty]');
        const accountLogoutLink = accountDropdown?.querySelector('[data-confirm-logout]');

        function togglePanel(toggle, panel) {
            if (!(toggle && panel)) return;
            const willOpen = !panel.classList.contains('open');
            closeTopbarDropdowns(panel.id);

            if (!willOpen) {
                closeTopbarPanel(panel);
                return;
            }

            if (panel.__stockwiseCloseTimer) {
                window.clearTimeout(panel.__stockwiseCloseTimer);
                panel.__stockwiseCloseTimer = null;
            }
            panel.classList.remove('is-closing');
            panel.classList.add('open');
            panel.setAttribute('aria-hidden', 'false');
            toggle.setAttribute('aria-expanded', 'true');
        }

        function applyNotificationTab(tabKey) {
            notificationTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.notificationTab === tabKey));
            let visibleCount = 0;
            notificationItems.forEach((item) => {
                const shouldShow = tabKey !== 'unread' || item.dataset.readState === 'unread';
                item.hidden = !shouldShow;
                if (shouldShow) visibleCount += 1;
            });
            if (notificationEmpty) {
                notificationEmpty.hidden = visibleCount > 0;
                notificationEmpty.textContent = tabKey === 'unread' ? 'No unread notifications yet.' : 'No notifications yet.';
            }
        }

        function updateNotificationBadge(unreadCount) {
            const count = Number(unreadCount || 0);
            topbar.querySelectorAll('.notification-badge').forEach((badge) => {
                if (count > 0) {
                    badge.textContent = count < 10 ? String(count) : '9+';
                } else {
                    badge.remove();
                }
            });
        }

        function markNotificationItemRead(item) {
            if (!item || item.dataset.readState !== 'unread') return;
            const notificationId = item.dataset.notificationId;
            if (!notificationId) return;

            fetch(`/notifications/${encodeURIComponent(notificationId)}/mark_read`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
            }).then((response) => response.ok ? response.json() : null)
                .then((payload) => {
                    item.dataset.readState = 'read';
                    item.classList.remove('unread');
                    if (payload && Object.prototype.hasOwnProperty.call(payload, 'unread_count')) {
                        updateNotificationBadge(payload.unread_count);
                    } else {
                        updateNotificationBadge(notificationItems.filter((entry) => entry.dataset.readState === 'unread').length);
                    }
                    applyNotificationTab(topbar.querySelector('[data-notification-tab].active')?.dataset.notificationTab || 'all');
                }).catch(() => {});
        }

        bindOnce(notificationToggle, 'click', 'topbar-notification-toggle', (event) => {
            event.stopPropagation();
            togglePanel(notificationToggle, notificationDropdown);
            applyNotificationTab(topbar.querySelector('[data-notification-tab].active')?.dataset.notificationTab || 'all');
        });

        bindOnce(accountToggle, 'click', 'topbar-account-toggle', (event) => {
            event.stopPropagation();
            togglePanel(accountToggle, accountDropdown);
        });

        notificationTabs.forEach((tab) => {
            bindOnce(tab, 'click', 'notification-tab', (event) => {
                event.stopPropagation();
                applyNotificationTab(tab.dataset.notificationTab || 'all');
            });
        });

        notificationItems.forEach((item) => {
            bindOnce(item, 'click', 'notification-item-read', (event) => {
                event.stopPropagation();
                markNotificationItemRead(item);
            });
        });

        bindOnce(accountLogoutLink, 'click', 'account-logout-confirm', (event) => {
            const logoutUrl = accountLogoutLink?.getAttribute('data-logout-url') || accountLogoutLink?.getAttribute('href') || '/logout';
            if (!openLogoutConfirmation(logoutUrl)) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            closeTopbarDropdowns();
        }, true);

        topbar.querySelectorAll('.topbar-dropdown-panel, .topbar-dropdown-panel a').forEach((item) => {
            bindOnce(item, 'click', 'topbar-dropdown-inner', (event) => {
                const logoutLink = event.target.closest('[data-confirm-logout]');
                if (logoutLink) {
                    closeTopbarDropdowns();
                    return;
                }

                const appLink = event.target.closest('a[data-app-link="true"]');
                if (item.matches('a') || appLink) {
                    closeTopbarDropdowns();
                    return;
                }

                event.stopPropagation();
            });
        });

        bindOnce(document.body, 'click', 'topbar-dropdown-outside', () => closeTopbarDropdowns());
        bindOnce(document, 'keydown', 'topbar-dropdown-escape', (event) => {
            if (event.key === 'Escape') closeTopbarDropdowns();
        });
        applyNotificationTab('all');
    }

    function updateDrawerBodyLock() {
        const hasOpenDrawer = !!document.querySelector("#reportFilterDrawer.open, #productDetailDrawer.open");
        document.body.classList.toggle("drawer-open", hasOpenDrawer);
    }

    function closeOpenDrawers(exceptId = "") {
        closeTopbarDropdowns();
        document.querySelectorAll("#reportFilterDrawer, #productDetailDrawer").forEach((drawer) => {
            if (drawer.id !== exceptId) {
                drawer.classList.remove("open");
                drawer.setAttribute("aria-hidden", "true");
            }
        });
        document.querySelectorAll("#reportFilterOverlay, #productDetailOverlay").forEach((overlay) => {
            const relatedDrawerId = overlay.id === "reportFilterOverlay" ? "reportFilterDrawer" : "productDetailDrawer";
            if (relatedDrawerId !== exceptId) {
                overlay.classList.remove("open");
                overlay.setAttribute("aria-hidden", "true");
            }
        });
        updateDrawerBodyLock();
    }


    function moveDrawerLayerToBody(root, drawerSelector, overlaySelector) {
        const drawer = root.querySelector(drawerSelector);
        const overlay = root.querySelector(overlaySelector);
        if (!(drawer && overlay)) return { drawer: null, overlay: null };

        document.querySelectorAll(`[id="${drawer.id}"]`).forEach((item) => {
            if (item !== drawer) item.remove();
        });
        document.querySelectorAll(`[id="${overlay.id}"]`).forEach((item) => {
            if (item !== overlay) item.remove();
        });

        drawer.classList.remove("open");
        overlay.classList.remove("open");
        drawer.setAttribute("aria-hidden", "true");
        overlay.setAttribute("aria-hidden", "true");

        document.body.appendChild(overlay);
        document.body.appendChild(drawer);
        updateDrawerBodyLock();

        return { drawer, overlay };
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeOpenDrawers();
        }
    });

    function closeHelpPopover() {
        if (activeHelpPopover) {
            activeHelpPopover.remove();
            activeHelpPopover = null;
        }
    }

    function closeHelpModal() {
        if (activeHelpModal) {
            activeHelpModal.remove();
            activeHelpModal = null;
        }
    }

    function closeHelpSurfaces() {
        closeHelpPopover();
        closeHelpModal();
    }

    function positionHelpPopover(button, popover) {
        const rect = button.getBoundingClientRect();
        const spacing = 10;
        const maxWidth = popover.offsetWidth;
        let top = rect.bottom + spacing;
        let left = rect.left + (rect.width / 2) - (maxWidth / 2);

        if (left < 12) left = 12;
        if (left + maxWidth > window.innerWidth - 12) {
            left = window.innerWidth - maxWidth - 12;
        }

        if (top + popover.offsetHeight > window.innerHeight - 12) {
            top = rect.top - popover.offsetHeight - spacing;
        }

        if (top < 12) top = 12;

        popover.style.top = `${top}px`;
        popover.style.left = `${left}px`;
    }

    function initializeHelpTips(root) {
        root.querySelectorAll('.help-tip').forEach((button) => {
            if (button.dataset.tipBound === 'true') return;
            button.dataset.tipBound = 'true';

            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();

                if (!button.dataset.tipUid) {
                    button.dataset.tipUid = `tip-${Math.random().toString(36).slice(2, 9)}`;
                }

                const tipMode = button.dataset.tipMode || 'popover';
                const isSamePopoverOpen = activeHelpPopover && activeHelpPopover.dataset.ownerId === button.dataset.tipUid;
                const isSameModalOpen = activeHelpModal && activeHelpModal.dataset.ownerId === button.dataset.tipUid;
                closeHelpSurfaces();
                if ((tipMode === 'modal' && isSameModalOpen) || (tipMode !== 'modal' && isSamePopoverOpen)) {
                    return;
                }

                const label = button.getAttribute('aria-label') || 'Help';
                const title = label.replace(/\s+help$/i, '');

                if (tipMode === 'modal') {
                    const targetSelector = button.dataset.tipTarget;
                    const source = targetSelector ? root.querySelector(targetSelector) || document.querySelector(targetSelector) : null;
                    const modal = document.createElement('div');
                    modal.className = 'help-modal-backdrop';
                    modal.dataset.ownerId = button.dataset.tipUid;
                    modal.innerHTML = `
                        <div class="help-modal-card" role="dialog" aria-modal="true" aria-label="${title}">
                            <div class="help-modal-header">
                                <h3 class="help-modal-title">${title}</h3>
                                <button type="button" class="help-modal-close" aria-label="Close help">×</button>
                            </div>
                            <div class="help-modal-body">${source ? source.innerHTML : '<p>No additional help available.</p>'}</div>
                        </div>
                    `;
                    document.body.appendChild(modal);
                    modal.querySelector('.help-modal-close')?.addEventListener('click', () => closeHelpModal());
                    modal.addEventListener('click', (modalEvent) => {
                        if (modalEvent.target === modal) {
                            closeHelpModal();
                        }
                    });
                    activeHelpModal = modal;
                    return;
                }

                const popover = document.createElement('div');
                popover.className = 'help-popover';
                popover.dataset.ownerId = button.dataset.tipUid;
                const content = button.dataset.tip || 'No additional help available.';
                popover.innerHTML = `<div class="help-popover-title">${title}</div><div>${content}</div>`;
                document.body.appendChild(popover);
                positionHelpPopover(button, popover);
                activeHelpPopover = popover;
            });
        });
    }



    function destroyManagedChart(key) {
        if (!key || !chartRegistry[key]) return;
        try {
            chartRegistry[key].destroy();
        } catch (error) {
            // Ignore safe destroy errors.
        }
        delete chartRegistry[key];
    }

    function destroyManagedCharts() {
        Object.keys(chartRegistry).forEach((key) => destroyManagedChart(key));
    }

    function safeParseJson(value, fallback) {
        if (!value) return fallback;
        try {
            return JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    }

    function estimateLabelRotation(labels, canvas) {
        if (!Array.isArray(labels) || labels.length <= 1) return 0;
        const width = canvas?.clientWidth || canvas?.parentElement?.clientWidth || 700;
        const longest = labels.reduce((max, label) => Math.max(max, String(label || '').length), 0);
        const estimatedLabelWidth = Math.min(160, Math.max(42, longest * 6.7));
        const availableSlot = width / Math.max(labels.length, 1);
        return estimatedLabelWidth > (availableSlot - 8) ? 35 : 0;
    }

    function applyReadableAxisLabels(options, labels, canvas, chartType) {
        if (!options || chartType === 'doughnut') return options;
        options.scales = options.scales || {};
        const isHorizontalBar = options.indexAxis === 'y';
        const axisKey = isHorizontalBar ? 'y' : 'x';
        options.scales[axisKey] = options.scales[axisKey] || {};
        options.scales[axisKey].ticks = options.scales[axisKey].ticks || {};

        const rotation = isHorizontalBar ? 0 : estimateLabelRotation(labels, canvas);
        options.scales[axisKey].ticks.minRotation = 0;
        options.scales[axisKey].ticks.maxRotation = rotation;
        if (rotation > 0) {
            options.scales[axisKey].ticks.autoSkip = true;
        }
        return options;
    }

    function renderManagedChart(key, canvas, labels, datasets, chartType = 'line', extraOptions = {}) {
        if (typeof Chart === "undefined" || !canvas) return;
        destroyManagedChart(key);

        const safeLabels = Array.isArray(labels) ? labels : [];
        const safeDatasets = Array.isArray(datasets)
            ? datasets
                .filter((dataset) => dataset && Array.isArray(dataset.data))
                .map((dataset) => ({
                    ...dataset,
                    spanGaps: dataset.spanGaps !== undefined ? dataset.spanGaps : chartType === 'line',
                    data: dataset.data.map((value) => (value === undefined ? null : value)),
                }))
                .filter((dataset) => dataset.data.length > 0)
            : [];

        if (!safeLabels.length || !safeDatasets.length) return;

        const chartOptions = applyReadableAxisLabels(Object.assign({
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 120 },
            resizeDelay: 80,
            plugins: {
                legend: {
                    position: "top",
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8,
                    },
                },
            },
            scales: chartType === 'doughnut' ? {} : {
                y: {
                    beginAtZero: true,
                    grid: { color: "#f0f0f0" },
                },
                x: {
                    grid: { display: false },
                },
            },
        }, extraOptions || {}), safeLabels, canvas, chartType || 'line');

        chartRegistry[key] = new Chart(canvas, {
            type: chartType || 'line',
            data: {
                labels: safeLabels,
                datasets: safeDatasets,
            },
            options: chartOptions,
        });
    }

    function initializeCharts(root) {
        if (typeof Chart === "undefined") return;

        destroyManagedCharts();

        root.querySelectorAll("canvas[data-chart-labels][data-chart-datasets]").forEach((canvas, index) => {
            const parentPanel = canvas.closest("[data-tab-panel]");
            if (parentPanel && !parentPanel.classList.contains("active")) return;
            const labels = safeParseJson(canvas.dataset.chartLabels, []);
            const datasets = safeParseJson(canvas.dataset.chartDatasets, []);
            const chartType = canvas.dataset.chartType || 'line';
            const chartOptions = safeParseJson(canvas.dataset.chartOptions, {});
            const key = canvas.id || `managed-chart-${index}`;
            renderManagedChart(key, canvas, labels, datasets, chartType, chartOptions);
        });
    }

    function applyFilters(tableId, searchInputSelector, filterSelectorGroup, root = document) {
        const table = root.querySelector(`#${tableId}`);
        if (!table) return;

        const rows = table.querySelectorAll("tbody tr");
        const searchInput = root.querySelector(searchInputSelector);
        const searchValue = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const filterSelects = filterSelectorGroup ? root.querySelectorAll(filterSelectorGroup) : [];
        let visibleCount = 0;

        rows.forEach((row) => {
            const cells = row.querySelectorAll("td");
            let show = true;

            if (searchValue) {
                const rowText = row.innerText.toLowerCase();
                if (!rowText.includes(searchValue)) {
                    show = false;
                }
            }

            filterSelects.forEach((select) => {
                const selectedValue = select.value.toLowerCase().trim();
                const columnIndex = parseInt(select.dataset.column, 10);

                if (selectedValue && !Number.isNaN(columnIndex) && cells[columnIndex]) {
                    const cellText = cells[columnIndex].innerText.toLowerCase().trim();
                    if (!cellText.includes(selectedValue)) {
                        show = false;
                    }
                }
            });

            row.style.display = show ? "" : "none";
            if (show) visibleCount += 1;
        });

        const emptyTargetId = table.dataset.emptyTarget;
        if (emptyTargetId) {
            const emptyTarget = root.querySelector(`#${emptyTargetId}`);
            if (emptyTarget) {
                emptyTarget.classList.toggle("hidden", visibleCount > 0);
            }
        }
    }

    function withTableRefreshTransition(target, callback) {
        if (!target || typeof callback !== "function") {
            if (typeof callback === "function") callback();
            return;
        }

        target.classList.add("is-refreshing");
        window.setTimeout(() => {
            callback();
            requestAnimationFrame(() => {
                target.classList.remove("is-refreshing");
            });
        }, 100);
    }

    function getProcessingOverlay(root) {
        const pageOverlay = root?.querySelector?.("#processingOverlay");
        const overlay = pageOverlay || document.getElementById("processingOverlay");
        if (!overlay) return null;

        // Keep only one global processing overlay.  When pages are loaded through
        // the SPA-style navigation, the template may briefly create a second
        // overlay inside #page-content. Moving the active one to <body> keeps it
        // above the sidebar/topbar and avoids fixed-position stacking issues.
        const bodyOverlay = Array.from(document.querySelectorAll("body > #processingOverlay"))
            .find((item) => item !== overlay);
        if (bodyOverlay) bodyOverlay.remove();

        if (overlay.parentElement !== document.body) {
            document.body.appendChild(overlay);
        }
        return overlay;
    }

    function setProcessingOverlayVisible(root, isVisible) {
        const overlay = getProcessingOverlay(root);
        if (!overlay) {
            document.body.classList.remove("processing-open");
            return;
        }
        overlay.classList.toggle("open", !!isVisible);
        overlay.setAttribute("aria-hidden", isVisible ? "false" : "true");
        document.body.classList.toggle("processing-open", !!isVisible);
    }

    function clearStaleInteractionBlockers(root = document) {
        const hasOpenProcessingOverlay = !!document.querySelector('.processing-feedback-overlay.open');
        if (!hasOpenProcessingOverlay) {
            document.body.classList.remove('processing-open');
            document.querySelectorAll('.processing-feedback-overlay').forEach((overlay) => {
                overlay.classList.remove('open');
                overlay.setAttribute('aria-hidden', 'true');
            });
        }

        if (!document.querySelector('#reportFilterDrawer.open, #productDetailDrawer.open')) {
            document.body.classList.remove('drawer-open');
        }

        const pageContent = root?.id === 'page-content' ? root : document.getElementById('page-content');
        const pageTransitionActive = pageContent?.dataset?.pageTransitionActive === 'true';
        if (pageContent && !pageTransitionActive) {
            pageContent.classList.remove('content-transitioning', 'content-entering');
            pageContent.removeAttribute('aria-busy');
        }
    }

    function playPageEnterTransition(pageContent = document.getElementById("page-content")) {
        if (!pageContent) return;

        if (pageEnterTransitionTimeout) {
            window.clearTimeout(pageEnterTransitionTimeout);
        }

        pageContent.dataset.pageTransitionActive = "true";
        pageContent.classList.remove("content-entering");
        void pageContent.offsetWidth;
        pageContent.classList.add("content-entering");

        pageEnterTransitionTimeout = window.setTimeout(() => {
            pageContent.classList.remove("content-entering");
            delete pageContent.dataset.pageTransitionActive;
            pageEnterTransitionTimeout = null;
        }, 260);
    }

    function bindGenerateResultsFeedback(root, syncUploadModeInputs) {
        const processForm = root.querySelector("#processResultsForm, form[data-processing-form='true']");
        if (!processForm || processForm.dataset.processingFeedbackBound === "true") return;
        processForm.dataset.processingFeedbackBound = "true";

        const submitButton = processForm.querySelector("[data-processing-submit], button[type='submit']");
        processForm.addEventListener("submit", (event) => {
            if (processForm.dataset.processingSubmitting === "true") return;
            if (submitButton && submitButton.disabled) {
                event.preventDefault();
                return;
            }

            event.preventDefault();
            processForm.dataset.processingSubmitting = "true";
            if (typeof syncUploadModeInputs === "function") syncUploadModeInputs();
            setProcessingOverlayVisible(root, true);

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.classList.add("is-processing");
                submitButton.dataset.originalText = submitButton.textContent || "Generate Results";
                submitButton.textContent = "Generating...";
            }

            Array.from(processForm.querySelectorAll("button, input, select, textarea")).forEach((control) => {
                if (control !== submitButton) control.setAttribute("aria-disabled", "true");
            });

            window.requestAnimationFrame(() => {
                window.setTimeout(() => {
                    processForm.submit();
                }, 60);
            });
        });
    }

    function warmUpGeneratedResultPages(root) {
        const successPanel = root.querySelector(".upload-success-panel");
        if (!successPanel || successPanel.dataset.generatedWarmupStarted === "true") return;
        successPanel.dataset.generatedWarmupStarted = "true";

        const navKeys = ["dashboard", "insights", "products", "reports"];
        const urls = navKeys
            .map((key) => document.querySelector(`[data-nav-key="${key}"]`)?.href)
            .filter(Boolean);

        if (!urls.length || typeof fetch !== "function") return;

        const runWarmup = () => {
            urls.forEach((url, index) => {
                window.setTimeout(() => {
                    fetch(url, {
                        credentials: "same-origin",
                        headers: { "X-StockWise-Prefetch": "true" },
                    }).catch(() => {});
                }, index * 180);
            });
        };

        if ("requestIdleCallback" in window) {
            window.requestIdleCallback(runWarmup, { timeout: 1500 });
        } else {
            window.setTimeout(runWarmup, 450);
        }
    }


    function initializeUploadInteractions(root) {
        const fileInput = root.querySelector("#fileInput");
        const dropzone = root.querySelector("#dropzone");
        const selectFileForm = root.querySelector("#selectFileForm");
        const uploadModeForm = root.querySelector("#uploadModeForm");
        const uploadModeControl = root.querySelector("#uploadModeControl");
        const selectedUploadModeInput = root.querySelector("#selectedUploadModeInput");
        const processUploadModeInput = root.querySelector("#processUploadModeInput");
        const wizard = root.querySelector("#uploadWizard");
        const uploadRoot = wizard || selectFileForm || uploadModeForm || dropzone;
        if (!uploadRoot || uploadRoot.dataset.uploadInitialized === 'true') return;
        uploadRoot.dataset.uploadInitialized = 'true';

        function syncUploadModeInputs() {
            if (!uploadModeControl) return;
            if (selectedUploadModeInput) selectedUploadModeInput.value = uploadModeControl.value;
            if (processUploadModeInput) processUploadModeInput.value = uploadModeControl.value;
        }

        setProcessingOverlayVisible(root, false);
        warmUpGeneratedResultPages(root);

        function updateUploadFeedback(message, messageType) {
            const fileInfoCard = root.querySelector('.file-info-card');
            if (!fileInfoCard) return;

            let feedback = fileInfoCard.querySelector('.upload-workspace-feedback');
            const hasMessage = Boolean(message);
            if (!feedback && hasMessage) {
                const previewBody = fileInfoCard.querySelector('.upload-file-preview-body') || fileInfoCard;
                feedback = document.createElement('p');
                feedback.className = 'upload-workspace-feedback';
                previewBody.appendChild(feedback);
            }
            if (!feedback) return;

            feedback.textContent = message || '';
            feedback.hidden = !hasMessage;
            feedback.classList.remove('danger-text', 'success-text', 'warning-text', 'info-text');
            if (hasMessage) {
                const className = messageType === 'error' ? 'danger-text' : messageType === 'success' ? 'success-text' : messageType === 'warning' ? 'warning-text' : 'info-text';
                feedback.classList.add(className);
            }
        }

        function updateGenerationFeedback(message, messageType) {
            const panel = root.querySelector('#feedbackPanel');
            if (!panel) return;

            const fallbackMessage = 'Review the summary, then generate results when the records are ready.';
            const text = message || fallbackMessage;
            const type = messageType || 'empty';
            const paragraph = document.createElement('p');
            paragraph.textContent = text;

            if (type === 'error') {
                paragraph.className = 'danger-text';
            } else if (type === 'warning') {
                paragraph.className = 'warning-text';
            } else if (type === 'success') {
                paragraph.className = 'success-text';
            } else if (type === 'info') {
                paragraph.className = 'info-text';
            } else {
                paragraph.className = 'empty-text';
            }

            panel.replaceChildren(paragraph);
        }

        function updateUploadModeLabels(modeLabel) {
            if (!modeLabel) return;
            root.querySelectorAll('[data-upload-mode-label]').forEach((label) => {
                label.textContent = modeLabel;
            });
        }

        function showUploadProgress(label = "Uploading sales file...") {
            const panel = root.querySelector("[data-upload-progress-panel]");
            if (!panel) return null;

            panel.hidden = false;
            panel.classList.add("is-visible");

            const labelEl = panel.querySelector("[data-upload-progress-label]");
            const bar = panel.querySelector("[data-upload-progress-bar]");
            const value = panel.querySelector("[data-upload-progress-value]");

            if (labelEl) labelEl.textContent = label;
            if (bar) bar.style.width = "0%";
            if (value) value.textContent = "0%";

            return { panel, labelEl, bar, value };
        }

        function updateUploadProgress(progressRefs, percent) {
            if (!progressRefs) return;
            const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
            if (progressRefs.bar) progressRefs.bar.style.width = `${safePercent}%`;
            if (progressRefs.value) progressRefs.value.textContent = `${safePercent}%`;
        }

        function submitUploadWithProgress(form, overrideFile = null) {
            if (!form || form.dataset.uploadSubmitting === "true") return;

            if (!window.XMLHttpRequest || !window.FormData || !window.DOMParser) {
                form.submit();
                return;
            }

            form.dataset.uploadSubmitting = "true";
            const progressRefs = showUploadProgress("Uploading sales file...");
            const formData = new FormData(form);
            if (overrideFile) {
                formData.set("file", overrideFile, overrideFile.name || "upload.csv");
            }
            const xhr = new XMLHttpRequest();

            xhr.open((form.getAttribute("method") || "POST").toUpperCase(), form.getAttribute("action") || window.location.href, true);
            xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    updateUploadProgress(progressRefs, (event.loaded / event.total) * 100);
                }
            };

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    updateUploadProgress(progressRefs, 100);

                    const parser = new DOMParser();
                    const doc = parser.parseFromString(xhr.responseText, "text/html");
                    const incomingContent = doc.getElementById("page-content");
                    const pageContent = document.getElementById("page-content");

                    if (incomingContent && pageContent) {
                        closeHelpSurfaces();
                        closeOpenDrawers();
                        destroyManagedCharts();
                        pageContent.innerHTML = incomingContent.innerHTML;
                        pageContent.dataset.pagePath = incomingContent.dataset.pagePath || new URL(form.getAttribute("action") || window.location.href, window.location.origin).pathname;
                        document.title = doc.title || document.title;
                        initializePage(pageContent);
                        playPageEnterTransition(pageContent);
                        return;
                    }
                }

                form.dataset.uploadSubmitting = "false";
                form.submit();
            };

            xhr.onerror = () => {
                form.dataset.uploadSubmitting = "false";
                form.submit();
            };

            xhr.send(formData);
        }

        if (uploadModeControl) {
            syncUploadModeInputs();
            bindOnce(uploadModeControl, "change", "upload-mode-ajax", () => {
                syncUploadModeInputs();
                if (!uploadModeForm || typeof fetch !== "function") {
                    uploadModeForm?.submit();
                    return;
                }

                const formData = new FormData(uploadModeForm);
                fetch(uploadModeForm.getAttribute("action") || window.location.href, {
                    method: uploadModeForm.getAttribute("method") || "POST",
                    body: formData,
                    credentials: "same-origin",
                    headers: {
                        "X-Requested-With": "XMLHttpRequest",
                        "Accept": "application/json",
                    },
                })
                    .then((response) => {
                        if (!response.ok) throw new Error("Upload mode update failed");
                        return response.json();
                    })
                    .then((payload) => {
                        updateUploadModeLabels(payload.mode_label);
                        updateUploadFeedback(payload.message, payload.message_type);
                        updateGenerationFeedback(payload.message, payload.message_type);
                    })
                    .catch(() => {
                        uploadModeForm.submit();
                    });
            });
        }

        bindGenerateResultsFeedback(root, syncUploadModeInputs);

        if (fileInput && selectFileForm) {
            bindOnce(fileInput, "change", "upload-file-progress", () => {
                if (fileInput.files && fileInput.files.length > 0) {
                    syncUploadModeInputs();
                    dropzone?.classList?.add("uploading");
                    submitUploadWithProgress(selectFileForm);
                }
            });
        }

        if (dropzone && fileInput && selectFileForm) {
            bindOnce(dropzone, "dragenter", "upload-drag-enter", (event) => {
                event.preventDefault();
                event.stopPropagation();
                dropzone.classList.add("dragover");
            });
            bindOnce(dropzone, "dragover", "upload-drag-over", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
                dropzone.classList.add("dragover");
            });
            bindOnce(dropzone, "dragleave", "upload-drag-leave", (event) => {
                event.preventDefault();
                event.stopPropagation();
                dropzone.classList.remove("dragover");
            });
            bindOnce(dropzone, "drop", "upload-drop-progress", (event) => {
                event.preventDefault();
                event.stopPropagation();
                dropzone.classList.remove("dragover");
                const files = event.dataTransfer?.files;
                if (!files || files.length === 0) return;
                const droppedFile = files[0];
                try {
                    const transfer = new DataTransfer();
                    transfer.items.add(droppedFile);
                    fileInput.files = transfer.files;
                } catch (error) {
                    // Some browser/security contexts do not allow assigning FileList.
                    // The XHR path below still sends the dropped file directly.
                }
                syncUploadModeInputs();
                dropzone.classList.add("uploading");
                submitUploadWithProgress(selectFileForm, droppedFile);
            });
        }

        if (!wizard) return;

        const stepButtons = Array.from(wizard.querySelectorAll('[data-upload-step]'));
        const stepPanels = Array.from(root.querySelectorAll('[data-upload-step-panel]'));
        const prevButtons = Array.from(root.querySelectorAll('[data-upload-prev]'));
        const nextButtons = Array.from(root.querySelectorAll('[data-upload-next]'));
        let maxStep = parseInt(wizard.dataset.maxStep || '1', 10);
        let currentStep = parseInt(wizard.dataset.currentStep || '1', 10);
        if (Number.isNaN(maxStep)) maxStep = 1;
        maxStep = Math.max(1, Math.min(maxStep, 4));

        function clampStep(step) {
            const parsed = parseInt(step || '1', 10);
            if (Number.isNaN(parsed)) return 1;
            return Math.max(1, Math.min(parsed, Math.max(maxStep, 1)));
        }

        function updateWizardButtons() {
            stepButtons.forEach((button) => {
                const buttonStep = parseInt(button.dataset.uploadStep || '1', 10);
                const locked = buttonStep > maxStep;
                button.classList.toggle('active', buttonStep === currentStep);
                button.classList.toggle('completed', buttonStep < currentStep && buttonStep <= maxStep);
                button.classList.toggle('locked', locked);
                button.disabled = locked;
                button.setAttribute('aria-disabled', locked ? 'true' : 'false');
                button.setAttribute('aria-current', buttonStep === currentStep ? 'step' : 'false');
            });

            prevButtons.forEach((button) => {
                button.disabled = currentStep <= 1;
            });

            nextButtons.forEach((button) => {
                button.disabled = currentStep >= maxStep;
            });
        }

        function setStep(step) {
            currentStep = clampStep(step);
            wizard.dataset.currentStep = String(currentStep);
            wizard.dataset.maxStep = String(maxStep);

            stepPanels.forEach((panel) => {
                const panelStep = parseInt(panel.dataset.uploadStepPanel || '1', 10);
                panel.classList.toggle('active', panelStep === currentStep);
            });

            updateWizardButtons();
        }

        root.querySelectorAll('[data-clear-upload-form]').forEach((form) => {
            bindOnce(form, 'submit', 'clear-upload-form', () => {
                if (fileInput) fileInput.value = '';
                dropzone?.classList?.remove('uploading', 'dragover');
                maxStep = 1;
                setStep(1);
            });
        });

        stepButtons.forEach((button) => {
            bindOnce(button, 'click', 'upload-step', () => {
                const targetStep = parseInt(button.dataset.uploadStep || '1', 10);
                if (targetStep > maxStep) return;
                setStep(targetStep);
            });
        });

        prevButtons.forEach((button) => {
            bindOnce(button, 'click', 'upload-prev', () => setStep(currentStep - 1));
        });

        nextButtons.forEach((button) => {
            bindOnce(button, 'click', 'upload-next', () => {
                if (button.disabled) return;
                setStep(currentStep + 1);
            });
        });

        setStep(currentStep);
    }


    function initializeFilters(root) {
        const productTable = root.querySelector("#productTable");
        const productSearch = root.querySelector("#productSearch");
        const productSelects = Array.from(root.querySelectorAll("#productCategoryFilter, #productRiskFilter, #productStatusFilter"));
        const productState = productTable ? readPageState("products") : {};

        function optionExists(select, value) {
            if (!select || value === undefined || value === null || value === "") return true;
            return Array.from(select.options || []).some((option) => option.value === value);
        }

        function saveProductsState() {
            if (!productTable) return;
            writePageState("products", {
                search: productSearch ? productSearch.value : "",
                category: root.querySelector("#productCategoryFilter")?.value || "",
                risk: root.querySelector("#productRiskFilter")?.value || "",
                status: root.querySelector("#productStatusFilter")?.value || "",
            });
        }

        if (productTable) {
            if (productSearch && typeof productState.search === "string") productSearch.value = productState.search;
            productSelects.forEach((select) => {
                const key = select.id === "productCategoryFilter" ? "category" : select.id === "productRiskFilter" ? "risk" : "status";
                const savedValue = productState[key];
                if (optionExists(select, savedValue)) select.value = savedValue || "";
            });
        }

        const productRefreshTarget = productTable?.closest(".product-table-scroll, .table-scroll-shell, .table-responsive, .card");
        const refreshProductTable = () => {
            withTableRefreshTransition(productRefreshTarget, () => {
                applyFilters("productTable", "#productSearch", "#productCategoryFilter, #productRiskFilter, #productStatusFilter", root);
                saveProductsState();
            });
        };

        if (productSearch) {
            bindOnce(productSearch, "input", "product-filter-search", refreshProductTable);
        }

        productSelects.forEach((select) => {
            bindOnce(select, "change", "product-filter-select", () => {
                if (root.querySelector("#productTable")) {
                    refreshProductTable();
                }
            });
        });

        if (productTable) {
            applyFilters("productTable", "#productSearch", "#productCategoryFilter, #productRiskFilter, #productStatusFilter", root);
        }

        const reportSearch = root.querySelector("#reportSearch");
        const reportTable = root.querySelector("#reportTable");
        const reportState = reportTable ? readPageState("reports") : {};
        if (reportSearch && typeof reportState.search === "string") reportSearch.value = reportState.search;

        const reportRefreshTarget = reportTable?.closest(".report-table-scroll, .table-scroll-shell, .table-responsive, .card");
        const refreshReportTable = () => {
            withTableRefreshTransition(reportRefreshTarget, () => {
                applyFilters("reportTable", "#reportSearch", "", root);
                if (reportTable) writePageState("reports", { search: reportSearch?.value || "" });
            });
        };

        if (reportSearch) {
            bindOnce(reportSearch, "input", "report-filter-search", refreshReportTable);
        }

        root.querySelectorAll(".report-top-controls .filter-select").forEach((select) => {
            bindOnce(select, "change", "report-filter-select", refreshReportTable);
        });

        if (reportTable) {
            applyFilters("reportTable", "#reportSearch", "", root);
        }
    }


    function initializeReportFilterDrawer(root) {
        const openBtn = root.querySelector("#openReportFilterDrawer");
        const layer = moveDrawerLayerToBody(root, "#reportFilterDrawer", "#reportFilterOverlay");
        const drawer = layer.drawer;
        const overlay = layer.overlay;

        if (!(drawer && overlay)) return;

        const closeBtn = drawer.querySelector("#closeReportFilterDrawer");
        const categorySelect = drawer.querySelector("#reportCategorySelect");
        const checklist = drawer.querySelector("#reportProductChecklist");
        const selectAll = drawer.querySelector("#reportSelectAllProducts");
        const emptyMessage = drawer.querySelector("#reportProductEmpty");
        const resetBtn = drawer.querySelector("#resetReportFilters");
        const filterForm = drawer.querySelector("#reportFilterForm");
        let isSubmittingReportFilter = false;

        function isReportProductOptionVisible(option) {
            if (!option) return false;
            const checkbox = option.querySelector('input[type="checkbox"]');
            return !option.classList.contains("hidden")
                && !option.hidden
                && option.style.display !== "none"
                && (!checkbox || !checkbox.disabled);
        }

        function setReportProductOptionVisibility(option, show) {
            if (!option) return;
            option.classList.toggle("hidden", !show);
            option.hidden = !show;
            option.setAttribute("aria-hidden", show ? "false" : "true");
            option.style.display = show ? "" : "none";

            const checkbox = option.querySelector('input[type="checkbox"]');
            if (checkbox) {
                checkbox.disabled = !show;
                if (!show) checkbox.checked = false;
            }
        }

        function visibleProductOptions() {
            if (!checklist) return [];
            return Array.from(checklist.querySelectorAll(".report-product-option"))
                .filter(isReportProductOptionVisible);
        }

        function updateSelectAllState() {
            if (!selectAll) return;
            const visible = visibleProductOptions();
            const checked = visible.filter((option) => option.querySelector('input[type="checkbox"]')?.checked);
            selectAll.checked = visible.length > 0 && checked.length === visible.length;
            selectAll.indeterminate = checked.length > 0 && checked.length < visible.length;
        }

        function updateProductOptions() {
            if (!checklist) return;
            const selectedCategory = categorySelect ? String(categorySelect.value || "").trim() : "";
            let visibleCount = 0;

            checklist.querySelectorAll(".report-product-option").forEach((option) => {
                const optionCategory = String(option.dataset.category || "").trim();
                const show = !selectedCategory || optionCategory === selectedCategory;
                setReportProductOptionVisibility(option, show);
                if (show) visibleCount += 1;
            });

            if (emptyMessage) {
                const hasVisibleProducts = visibleCount > 0;
                emptyMessage.classList.toggle("hidden", hasVisibleProducts);
                emptyMessage.hidden = hasVisibleProducts;
                emptyMessage.style.display = hasVisibleProducts ? "none" : "";
            }

            updateSelectAllState();
        }

        function getAppliedReportFilterSnapshot() {
            if (!filterForm) return null;
            return {
                reportType: filterForm.querySelector('select[name="report_type"]')?.value || "demand_forecast_summary",
                period: filterForm.querySelector('select[name="period"]')?.value || "last_30_days",
                risk: filterForm.querySelector('select[name="risk"]')?.value || "",
                category: categorySelect?.value || "",
                products: checklist
                    ? Array.from(checklist.querySelectorAll('input[name="products"]:checked')).map((checkbox) => checkbox.value)
                    : [],
            };
        }

        const appliedReportFilterSnapshot = getAppliedReportFilterSnapshot();

        function restoreReportFilterSnapshot(snapshot) {
            if (!snapshot || !filterForm) return;
            const reportType = filterForm.querySelector('select[name="report_type"]');
            const period = filterForm.querySelector('select[name="period"]');
            const risk = filterForm.querySelector('select[name="risk"]');

            if (reportType) reportType.value = snapshot.reportType;
            if (period) period.value = snapshot.period;
            if (risk) risk.value = snapshot.risk;
            if (categorySelect) categorySelect.value = snapshot.category;

            if (checklist) {
                checklist.querySelectorAll('input[name="products"]').forEach((checkbox) => {
                    checkbox.checked = snapshot.products.includes(checkbox.value);
                });
            }
            updateProductOptions();
            updateSelectAllState();
        }

        function openDrawer() {
            if (openBtn && (openBtn.disabled || openBtn.getAttribute("aria-disabled") === "true")) return;
            closeOpenDrawers("reportFilterDrawer");
            isSubmittingReportFilter = false;
            restoreReportFilterSnapshot(appliedReportFilterSnapshot);
            drawer.classList.add("open");
            overlay.classList.add("open");
            drawer.setAttribute("aria-hidden", "false");
            overlay.setAttribute("aria-hidden", "false");
            updateDrawerBodyLock();
        }

        function closeDrawer() {
            if (!isSubmittingReportFilter) restoreReportFilterSnapshot(appliedReportFilterSnapshot);
            drawer.classList.remove("open");
            overlay.classList.remove("open");
            drawer.setAttribute("aria-hidden", "true");
            overlay.setAttribute("aria-hidden", "true");
            updateDrawerBodyLock();
        }

        function resetVisibleReportFilters() {
            if (filterForm) {
                const reportType = filterForm.querySelector('select[name="report_type"]');
                const period = filterForm.querySelector('select[name="period"]');
                const risk = filterForm.querySelector('select[name="risk"]');
                if (reportType) reportType.value = "demand_forecast_summary";
                if (period) period.value = "last_30_days";
                if (risk) risk.value = "";
            }
            if (categorySelect) categorySelect.value = "";
            if (checklist) {
                checklist.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
                    checkbox.checked = false;
                });
            }
            if (selectAll) {
                selectAll.checked = false;
                selectAll.indeterminate = false;
            }
            updateProductOptions();
        }

        bindOnce(openBtn, "click", "report-drawer-open", openDrawer);
        bindOnce(closeBtn, "click", "report-drawer-close", closeDrawer);
        bindOnce(overlay, "click", "report-drawer-overlay", closeDrawer);
        bindOnce(document, "keydown", "report-drawer-escape-restore", (event) => {
            if (event.key === "Escape" && drawer.classList.contains("open")) closeDrawer();
        });
        if (filterForm) {
            bindOnce(filterForm, "submit", "report-filter-submit", () => {
                isSubmittingReportFilter = true;
            });
        }
        if (categorySelect) {
            bindOnce(categorySelect, "change", "report-category-filter", () => {
                updateProductOptions();
            });
        }
        if (selectAll) {
            bindOnce(selectAll, "change", "report-select-all", () => {
                visibleProductOptions().forEach((option) => {
                    const checkbox = option.querySelector('input[type="checkbox"]');
                    if (checkbox) checkbox.checked = selectAll.checked;
                });
                updateSelectAllState();
            });
        }
        if (checklist) {
            bindOnce(checklist, "change", "report-checklist", (event) => {
                if (event.target && event.target.matches('input[type="checkbox"]')) {
                    updateSelectAllState();
                }
            });
        }
        if (resetBtn) {
            bindOnce(resetBtn, "click", "report-reset-visible-filters", () => {
                resetVisibleReportFilters();
            });
        }
        restoreReportFilterSnapshot(appliedReportFilterSnapshot);
    }

    function initializeReportExport(root) {
        const btnExportReport = root.querySelector("#btnExportReport");
        const exportFeedback = root.querySelector("#exportFeedback");
        let exportMenu = null;

        function getVisibleTableData() {
            const table = root.querySelector("#reportTable");
            if (!table) return { rows: [], header: [] };
            const allRows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.style.display !== "none");
            const header = Array.from(table.querySelectorAll("thead th")).map((cell) => cell.innerText.trim());
            const rows = allRows.map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.innerText.replace(/\s+/g, " ").trim()));
            return { rows, header };
        }

        function setExportFeedback(message, isError = false) {
            if (!exportFeedback) return;
            exportFeedback.innerText = message;
            exportFeedback.classList.remove("hidden", "danger-text", "success-text");
            exportFeedback.classList.toggle("danger-text", !!isError);
            exportFeedback.classList.toggle("success-text", !isError);
        }

        function clearExportFeedback() {
            if (!exportFeedback) return;
            exportFeedback.classList.add("hidden");
            exportFeedback.classList.remove("danger-text", "success-text");
        }

        function escapeCsv(value) {
            const text = String(value || "").replace(/(\r\n|\n|\r)/gm, " ").trim();
            return `"${text.replace(/"/g, '""')}"`;
        }

        function buildCsvFromData(header, rows) {
            const lines = [header.map(escapeCsv).join(",")];
            rows.forEach((row) => lines.push(row.map(escapeCsv).join(",")));
            return lines.join("\r\n");
        }

        function escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function buildExcelHtml(header, rows) {
            const head = header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("");
            const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
            return `<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
        }

        function filenameFor(format) {
            const dateLabel = new Date().toISOString().slice(0, 10);
            return `StockWise_Report_${dateLabel}.${format}`;
        }

        async function saveBlob(blob, filename, description, accept) {
            if (window.showSaveFilePicker) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: filename,
                        types: [{ description, accept }],
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    setExportFeedback("Report exported successfully.");
                    return true;
                } catch (error) {
                    if (error && error.name === "AbortError") {
                        setExportFeedback("Export canceled.", true);
                        return false;
                    }
                }
            }

            const link = document.createElement("a");
            const objectUrl = URL.createObjectURL(blob);
            link.href = objectUrl;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(objectUrl);
            setExportFeedback("Saved through browser download.");
            return true;
        }

        function closeExportMenu() {
            if (exportMenu) {
                exportMenu.remove();
                exportMenu = null;
            }
        }

        function showExportMenu() {
            closeExportMenu();
            if (!btnExportReport) return;

            exportMenu = document.createElement("div");
            exportMenu.className = "report-export-menu";
            exportMenu.setAttribute("role", "dialog");
            exportMenu.setAttribute("aria-label", "Choose export format");
            exportMenu.innerHTML = `
                <div class="report-export-menu-card">
                    <div class="report-export-menu-title">Choose export format</div>
                    <button type="button" data-export-format="csv">CSV</button>
                    <button type="button" data-export-format="xlsx">XLSX</button>
                    <button type="button" data-export-format="xls">XLS</button>
                    <button type="button" data-export-format="pdf">PDF</button>
                </div>
            `;
            document.body.appendChild(exportMenu);
            const rect = btnExportReport.getBoundingClientRect();
            const card = exportMenu.querySelector(".report-export-menu-card");
            if (card) {
                requestAnimationFrame(() => {
                    const cardWidth = card.offsetWidth || 160;
                    const cardHeight = card.offsetHeight || 190;
                    const gap = 8;
                    const safeMargin = 16;
                    const top = Math.max(
                        safeMargin,
                        Math.min(rect.bottom + gap, window.innerHeight - cardHeight - safeMargin)
                    );
                    const left = Math.max(
                        safeMargin,
                        Math.min(rect.right - cardWidth, window.innerWidth - cardWidth - safeMargin)
                    );

                    card.style.top = `${top}px`;
                    card.style.left = `${left}px`;
                    card.style.right = "auto";
                });
            }

            bindOnce(exportMenu, "click", "report-export-menu", (event) => {
                if (event.target === exportMenu) {
                    closeExportMenu();
                    return;
                }
                const option = event.target.closest("[data-export-format]");
                if (!option) return;
                const format = option.dataset.exportFormat;
                closeExportMenu();
                exportReport(format);
            });

            bindOnce(document.body, "keydown", "report-export-menu-escape", (event) => {
                if (event.key === "Escape") closeExportMenu();
            });
        }

        function logReportExport(format, status = "Success") {
            fetch("/reports/export/log", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Requested-With": "XMLHttpRequest",
                },
                credentials: "same-origin",
                body: JSON.stringify({ format, status }),
            }).catch(() => {});
        }

        async function exportReport(format) {
            const { rows, header } = getVisibleTableData();
            if (!rows.length) {
                setExportFeedback("No report records are available for export based on the current filters.", true);
                return;
            }
            clearExportFeedback();

            try {
                if (format === "csv") {
                    const blob = new Blob([buildCsvFromData(header, rows)], { type: "text/csv;charset=utf-8" });
                    const saved = await saveBlob(blob, filenameFor("csv"), "CSV file", { "text/csv": [".csv"] });
                    if (saved) logReportExport(format, "Success");
                    return;
                }

                if (format === "xls") {
                    const blob = new Blob([buildExcelHtml(header, rows)], { type: "application/vnd.ms-excel;charset=utf-8" });
                    const saved = await saveBlob(blob, filenameFor("xls"), "Excel 97-2003 file", { "application/vnd.ms-excel": [".xls"] });
                    if (saved) logReportExport(format, "Success");
                    return;
                }

                if (format === "xlsx") {
                    const response = await fetch("/reports/export/xlsx", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ headers: header, rows }),
                    });
                    if (!response.ok) {
                        const payload = await response.json().catch(() => null);
                        throw new Error(payload?.message || "XLSX export failed.");
                    }
                    const blob = await response.blob();
                    const saved = await saveBlob(blob, filenameFor("xlsx"), "Excel workbook", { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] });
                    if (saved) logReportExport(format, "Success");
                    return;
                }

                if (format === "pdf") {
                    const printWindow = window.open("", "_blank", "width=1000,height=700");
                    if (!printWindow) {
                        setExportFeedback("Allow popups to use the PDF print option.", true);
                        logReportExport(format, "Failed");
                        return;
                    }
                    printWindow.document.write(`
                        <!doctype html>
                        <html>
                        <head>
                            <title>StockWise Report</title>
                            <style>
                                body { font-family: Arial, sans-serif; padding: 24px; color: #333; }
                                h1 { font-size: 20px; margin: 0 0 16px; }
                                table { width: 100%; border-collapse: collapse; font-size: 11px; }
                                th, td { border: 1px solid #e6e0cd; padding: 8px; text-align: left; vertical-align: top; }
                                th { background: #FFE58A; }
                            </style>
                        </head>
                        <body>
                            <h1>StockWise Report</h1>
                            <table><thead><tr>${header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>
                        </body>
                        </html>
                    `);
                    printWindow.document.close();
                    printWindow.focus();
                    setTimeout(() => printWindow.print(), 250);
                    setExportFeedback("Use the print dialog to save the report as PDF.");
                    logReportExport(format, "Success");
                }
            } catch (error) {
                setExportFeedback(error?.message || "Export failed. Please try again.", true);
                logReportExport(format, "Failed");
            }
        }

        if (btnExportReport) {
            bindOnce(btnExportReport, "click", "report-export", () => {
                const { rows } = getVisibleTableData();
                if (!rows.length) {
                    setExportFeedback("No report records are available for export based on the current filters.", true);
                    return;
                }
                showExportMenu();
            });
        }
    }

    function initializeInsightsTabs(root) {
        const tabsContainer = root.querySelector("#insightsTabs");
        if (!tabsContainer || tabsContainer.dataset.tabsInitialized === "true") return;
        tabsContainer.dataset.tabsInitialized = "true";

        const buttons = tabsContainer.querySelectorAll(".insights-tab-btn");
        const panels = root.querySelectorAll("[data-tab-panel]");
        const savedState = readPageState("insights");
        const urlParams = new URLSearchParams(window.location.search);
        const requestedTab = urlParams.get("tab");
        const validTabs = Array.from(buttons).map((button) => button.dataset.tabTarget);

        function normalizeTab(tabKey) {
            return validTabs.includes(tabKey) ? tabKey : "forecast";
        }

        function activateTab(tabKey, updateUrl = true) {
            const safeTab = normalizeTab(tabKey);
            buttons.forEach((button) => {
                button.classList.toggle("active", button.dataset.tabTarget === safeTab);
            });

            panels.forEach((panel) => {
                panel.classList.toggle("active", panel.dataset.tabPanel === safeTab);
            });

            tabsContainer.dataset.activeTab = safeTab;
            writePageState("insights", { tab: safeTab });
            tabsContainer.dispatchEvent(new CustomEvent("stockwise:insights-tab", { detail: { tabKey: safeTab } }));

            if (updateUrl) {
                const url = new URL(window.location.href);
                url.searchParams.set("tab", safeTab);
                window.history.replaceState({ path: url.toString() }, "", url.toString());
            }
        }

        buttons.forEach((button) => {
            button.addEventListener("click", () => {
                activateTab(button.dataset.tabTarget, true);
            });
        });

        const initialTab = normalizeTab(requestedTab || savedState.tab || tabsContainer.dataset.activeTab || "forecast");
        activateTab(initialTab, false);
    }

    function initializeInsightsForecast(root) {
        const payloadScript = root.querySelector("#forecastPayload");
        if (!payloadScript || payloadScript.dataset.forecastInitialized === "true") return;

        const forecastPanel = root.querySelector('[data-tab-panel="forecast"]');
        const tabsContainer = root.querySelector("#insightsTabs");
        if (forecastPanel && !forecastPanel.classList.contains("active")) {
            if (tabsContainer && tabsContainer.dataset.forecastLazyBound !== "true") {
                tabsContainer.dataset.forecastLazyBound = "true";
                tabsContainer.addEventListener("stockwise:insights-tab", (event) => {
                    if (event.detail && event.detail.tabKey === "forecast") {
                        initializeInsightsForecast(root);
                    }
                });
            }
            return;
        }
        payloadScript.dataset.forecastInitialized = "true";

        const payload = safeParseJson(payloadScript.textContent, null);
        if (!payload || !payload.products || !payload.products.length) return;

        const productSelect = root.querySelector("#forecastProductSelect");
        const categorySelect = root.querySelector("#forecastCategorySelect");
        const rangeButtons = root.querySelectorAll("[data-forecast-range]");
        const demandValue = root.querySelector("#forecastDemandValue");
        const demandLabel = root.querySelector("#forecastDemandLabel");
        const trendValue = root.querySelector("#forecastTrendValue");
        const actionValue = root.querySelector("#forecastActionValue");
        const suggestedStock = root.querySelector("#forecastSuggestedStock");
        const explanationBox = root.querySelector("#forecastExplanationBox");
        const tableBody = root.querySelector("#insightsForecastTableBody");
        const chartCanvas = root.querySelector("#insightsForecastChart");
        const chartMessage = root.querySelector("#forecastChartMessage");
        const chartExplanation = root.querySelector("#forecastChartExplanation");
        const forecastStartLabel = root.querySelector("#forecastStartLabel");
        const reviewList = root.querySelector("#productsToReviewFirst");

        const filterRefs = {
            total: root.querySelector("#filterTotalProducts"),
            high: root.querySelector("#filterHighRiskProducts"),
            rising: root.querySelector("#filterRisingDemandProducts"),
            lowStock: root.querySelector("#filterLowStockProducts"),
                    };

        const savedInsightsState = readPageState("insights");
        let activeRange = savedInsightsState.range || (payload.initial_view && payload.initial_view.range_key) || "daily";
        if (!payload.details_by_range || !payload.details_by_range[activeRange]) activeRange = "daily";

        function escapeText(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function riskPillHtml(level) {
            if (level === "High") return '<span class="pill high">High</span>';
            if (level === "Moderate") return '<span class="pill moderate">Moderate</span>';
            if (level === "Low") return '<span class="pill low">Safe</span>';
            return '<span class="pill neutral">Needs review</span>';
        }

        function getSelectedProduct() {
            return productSelect ? (productSelect.value || "__total__") : "__total__";
        }

        function getSelectedCategory() {
            return categorySelect ? categorySelect.value : "";
        }

        function optionValueExists(select, value) {
            if (!select || value === undefined || value === null || value === "") return true;
            return Array.from(select.options || []).some((option) => option.value === value);
        }

        function saveInsightsForecastState() {
            writePageState("insights", {
                tab: "forecast",
                range: activeRange,
                product: getSelectedProduct(),
                category: getSelectedCategory(),
            });
        }

        function getRowsForRange() {
            return (payload.details_by_range && payload.details_by_range[activeRange]) || [];
        }

        function getFilteredRows() {
            const categoryValue = getSelectedCategory();
            const productValue = getSelectedProduct();
            return getRowsForRange().filter((row) => {
                if (categoryValue && row.category !== categoryValue) return false;
                if (productValue && productValue !== "__total__" && row.product_name !== productValue) return false;
                return true;
            });
        }

        function syncProductOptions() {
            if (!productSelect) return;
            const currentValue = productSelect.value || "__total__";
            const categoryValue = getSelectedCategory();
            const rows = getRowsForRange();
            const allowedProducts = payload.products.filter((product) => {
                if (!categoryValue) return true;
                return rows.some((row) => row.product_name === product && row.category === categoryValue);
            });

            productSelect.innerHTML = "";
            const totalOption = document.createElement("option");
            totalOption.value = "__total__";
            totalOption.textContent = categoryValue ? `All Products in ${categoryValue}` : "All Products";
            productSelect.appendChild(totalOption);

            allowedProducts.forEach((product) => {
                const option = document.createElement("option");
                option.value = product;
                option.textContent = product;
                productSelect.appendChild(option);
            });

            if (currentValue === "__total__" || allowedProducts.includes(currentValue)) {
                productSelect.value = currentValue;
            } else {
                productSelect.value = "__total__";
            }
        }

        function getActiveSummary() {
            const productValue = getSelectedProduct();
            const categoryValue = getSelectedCategory();
            if (productValue && productValue !== "__total__") {
                return payload.summary_map?.[productValue]?.[activeRange] || {};
            }
            if (categoryValue) {
                return payload.category_summary_map?.[categoryValue]?.[activeRange] || {};
            }
            return payload.summary_map?.__total__?.[activeRange] || {};
        }

        function getActiveChart() {
            const productValue = getSelectedProduct();
            const categoryValue = getSelectedCategory();
            if (productValue && productValue !== "__total__") {
                return payload.chart_map?.[productValue]?.[activeRange] || {};
            }
            if (categoryValue) {
                return payload.category_chart_map?.[categoryValue]?.[activeRange] || {};
            }
            return payload.chart_map?.__total__?.[activeRange] || {};
        }

        function updateFilterMetrics(rows) {
            const highCount = rows.filter((row) => row.risk_level === "High").length;
            const risingCount = rows.filter((row) => row.trend === "Rising").length;
            const lowStockCount = rows.filter((row) => row.is_low_stock).length;
            if (filterRefs.total) filterRefs.total.textContent = rows.length;
            if (filterRefs.high) filterRefs.high.textContent = highCount;
            if (filterRefs.rising) filterRefs.rising.textContent = risingCount;
            if (filterRefs.lowStock) filterRefs.lowStock.textContent = lowStockCount;
        }

        function renderReviewFirst(rows) {
            if (!reviewList) return;
            reviewList.innerHTML = "";
            const priorityRows = rows.slice(0, 5);
            if (!priorityRows.length) {
                reviewList.innerHTML = `
                    <div class="empty-state-panel compact-empty-panel clear-border">
                        <div class="empty-state-text">No records available yet.</div>
                    </div>
                `;
                return;
            }

            priorityRows.forEach((row) => {
                const item = document.createElement("div");
                item.className = "review-first-item";
                item.classList.add("compact-review-item");
                item.innerHTML = `
                    <div class="review-first-name">
                        <strong>${escapeText(row.product_name || "No records available yet")}</strong>
                    </div>
                    <div class="review-first-risk">${riskPillHtml(row.risk_level)}</div>
                    <div class="review-first-decision">${escapeText(row.suggested_action || "Needs review")}</div>
                `;
                reviewList.appendChild(item);
            });
        }

        function renderForecastTable(rows) {
            if (!tableBody) return;
            tableBody.innerHTML = "";
            if (!rows.length) {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td colspan="8" class="empty-table-cell">No records available yet.</td>`;
                tableBody.appendChild(tr);
                return;
            }

            rows.forEach((row) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${escapeText(row.product_name || "No records available yet")}</td>
                    <td>${escapeText(row.category || "Uncategorized")}</td>
                    <td>${escapeText(row.forecast_period || "Selected period")}</td>
                    <td>${escapeText(row.forecast_demand ?? "Forecast not ready")}</td>
                    <td>${escapeText(row.trend || "Stable")}</td>
                    <td>${riskPillHtml(row.risk_level)}</td>
                    <td>${escapeText(row.suggested_action || "Needs review")}</td>
                    <td><div>${escapeText(row.notes || "No records available yet.")}</div></td>
                `;
                tableBody.appendChild(tr);
            });
        }

        function renderForecastSummary() {
            const summary = getActiveSummary();
            const chart = getActiveChart();
            const productValue = getSelectedProduct();

            if (demandValue) demandValue.textContent = summary.forecast_demand ?? "Forecast not ready";
            if (demandLabel) demandLabel.textContent = summary.forecast_status_label || "Based on uploaded sales records";
            if (trendValue) trendValue.textContent = summary.trend || "Stable";
            if (actionValue) actionValue.textContent = summary.suggested_action || "Monitor only";
            if (suggestedStock) {
                const additional = Number(summary.recommended_additional_stock || 0);
                suggestedStock.textContent = productValue !== "__total__" && additional > 0
                    ? `Suggested additional stock: +${additional} units`
                    : (summary.forecast_note || "Based on uploaded sales records.");
            }
            if (explanationBox) {
                explanationBox.textContent = summary.display_note || summary.why_flagged || "Upload and process a file to view forecast insights.";
            }
            if (chartExplanation) {
                const explanation = chart.chart_explanation || "";
                chartExplanation.textContent = explanation;
                chartExplanation.classList.toggle("hidden", !explanation);
            }
            if (chartMessage) {
                const hasChartData = Array.isArray(chart.chart_labels) && chart.chart_labels.length && Array.isArray(chart.chart_datasets) && chart.chart_datasets.length;
                const message = chart.chart_message || (hasChartData ? "" : "No chart data available yet.");
                chartMessage.textContent = message;
                chartMessage.classList.toggle("hidden", !message);
            }
            if (forecastStartLabel) {
                const startLabel = chart.forecast_start_label ? `Forecast starts here: ${chart.forecast_start_label}` : "";
                forecastStartLabel.textContent = startLabel;
                forecastStartLabel.classList.toggle("hidden", !startLabel);
            }

            renderManagedChart("insightsForecastChart", chartCanvas, chart.chart_labels || [], chart.chart_datasets || [], chart.chart_type || "line", Object.assign({}, chart.chart_options || {}, { animation: { duration: 260, easing: 'easeOutQuart' }, resizeDelay: 60 }));
        }

        function animateForecastRefresh(callback) {
            const targets = [
                root.querySelector('.insights-demand-card'),
                root.querySelector('.compact-priority-card'),
                root.querySelector('#insightsForecastTable')?.closest('.table-scroll-wrap, .table-scroll-shell, .table-responsive'),
                root.querySelector('#insightsFilterSummary')
            ].filter(Boolean);

            targets.forEach((target) => target.classList.add('is-refreshing'));
            window.setTimeout(() => {
                callback();
                requestAnimationFrame(() => {
                    targets.forEach((target) => target.classList.remove('is-refreshing'));
                });
            }, 120);
        }

        function renderForecastState() {
            syncProductOptions();
            const rows = getFilteredRows();
            updateFilterMetrics(rows);
            renderReviewFirst(rows);
            renderForecastSummary();
            renderForecastTable(rows);
        }

        function applySavedForecastControls() {
            if (categorySelect && optionValueExists(categorySelect, savedInsightsState.category)) {
                categorySelect.value = savedInsightsState.category || "";
            }
            rangeButtons.forEach((item) => item.classList.toggle("active", item.dataset.forecastRange === activeRange));
            syncProductOptions();
            if (productSelect && optionValueExists(productSelect, savedInsightsState.product)) {
                productSelect.value = savedInsightsState.product || "__total__";
            }
        }

        if (productSelect) {
            productSelect.addEventListener("change", () => {
                animateForecastRefresh(() => {
                    renderForecastState();
                    saveInsightsForecastState();
                });
            });
        }
        if (categorySelect) {
            categorySelect.addEventListener("change", () => {
                animateForecastRefresh(() => {
                    renderForecastState();
                    saveInsightsForecastState();
                });
            });
        }
        rangeButtons.forEach((button) => {
            button.addEventListener("click", () => {
                activeRange = button.dataset.forecastRange;
                rangeButtons.forEach((item) => item.classList.toggle("active", item === button));
                animateForecastRefresh(() => {
                    renderForecastState();
                    saveInsightsForecastState();
                });
            });
        });

        applySavedForecastControls();
        renderForecastState();
        saveInsightsForecastState();
    }

    function initializeProductDetails(root) {
        const page = root.querySelector("#productsPage");
        if (!page || page.dataset.productDetailsInitialized === 'true') return;
        page.dataset.productDetailsInitialized = 'true';

        const detailMap = safeParseJson(page.dataset.productDetailMap, {});
        const layer = moveDrawerLayerToBody(root, "#productDetailDrawer", "#productDetailOverlay");
        const drawer = layer.drawer;
        const overlay = layer.overlay;
        if (!drawer || !overlay) return;

        const closeBtn = drawer.querySelector("#productDetailClose");
        const refs = {
            name: drawer.querySelector("#drawerProductName"),
            categoryLine: drawer.querySelector("#drawerProductCategory"),
            currentStock: drawer.querySelector("#drawerCurrentStock"),
            forecastDemand: drawer.querySelector("#drawerForecastDemand"),
            category: drawer.querySelector("#drawerCategory"),
            unitType: drawer.querySelector("#drawerUnitType"),
            stockStatusText: drawer.querySelector("#drawerStockStatusText"),
            reorderPoint: drawer.querySelector("#drawerReorderPoint"),
            lastProcessed: drawer.querySelector("#drawerLastProcessed"),
            riskPillRow: drawer.querySelector("#drawerRiskPillRow"),
            whyFlagged: drawer.querySelector("#drawerWhyFlagged"),
            modelMeta: drawer.querySelector("#drawerModelMeta"),
            trend: drawer.querySelector("#drawerTrend"),
            suggestedAction: drawer.querySelector("#drawerSuggestedAction"),
            forecastHorizon: drawer.querySelector("#drawerForecastHorizon"),
            modelRunTimestamp: drawer.querySelector("#drawerModelRunTimestamp"),
            topFactors: drawer.querySelector("#drawerTopFactors"),
            detailNote: drawer.querySelector("#drawerDetailNote"),
            buyerPattern: drawer.querySelector("#drawerBuyerPattern"),
            preparationGuide: drawer.querySelector("#drawerPreparationGuide"),
            recentSalesTotal: drawer.querySelector("#drawerRecentSalesTotal"),
            averageDailyDemand: drawer.querySelector("#drawerAverageDailyDemand"),
            recentSalesList: drawer.querySelector("#drawerRecentSalesList"),
            recentSalesChart: drawer.querySelector("#drawerRecentSalesChart"),
            recentSalesChartMessage: drawer.querySelector("#drawerRecentSalesChartMessage"),
        };

        function setText(ref, value, fallback = "-") {
            if (ref) ref.textContent = value ?? fallback;
        }

        function buildRiskPill(level, stockStatus) {
            const safeLevel = level || "Needs review";
            const riskClass = safeLevel === "High" ? "high" : safeLevel === "Moderate" ? "moderate" : safeLevel === "Low" ? "low" : "neutral";
            return `<span class="pill ${riskClass}">${safeLevel}</span>`;
        }

        function buildRecentSalesChart(detail, recentPoints) {
            const labelsFromPoints = recentPoints.map((point) => point.date);
            const valuesFromPoints = recentPoints.map((point) => Number(point.quantity || 0));
            const chart = detail.recent_sales_chart || {};
            const labels = Array.isArray(chart.labels) && chart.labels.length ? chart.labels : labelsFromPoints;
            const values = Array.isArray(chart.values) && chart.values.length ? chart.values : valuesFromPoints;
            const hasData = labels.length > 0 && values.some((value) => Number(value) > 0);

            if (refs.recentSalesChartMessage) {
                refs.recentSalesChartMessage.textContent = hasData ? "" : "No chart data available yet.";
                refs.recentSalesChartMessage.classList.toggle("hidden", hasData);
            }

            if (!refs.recentSalesChart) return;

            if (!hasData) {
                renderManagedChart("product-detail-recent-sales", refs.recentSalesChart, [], [], "line", {});
                return;
            }

            const datasets = [{
                label: "Recent Sales",
                data: values,
                borderColor: "#f4d35e",
                backgroundColor: "rgba(244, 211, 94, 0.18)",
                tension: 0.32,
                fill: true,
            }];

            renderManagedChart("product-detail-recent-sales", refs.recentSalesChart, labels, datasets, "line", {
                plugins: { legend: { display: false } },
            });
        }

        function openDrawer(productName) {
            const detail = detailMap[productName];
            if (!detail) return;

            setText(refs.name, detail.product_name || "Product Record");
            setText(refs.categoryLine, `${detail.category || "Uncategorized"} • ${detail.unit_type || "Unit"}`);
            setText(refs.currentStock, detail.current_stock);
            setText(refs.forecastDemand, detail.forecast_demand);
            setText(refs.category, detail.category || "-");
            setText(refs.unitType, detail.unit_type || "-");
            setText(refs.stockStatusText, detail.stock_status || "Needs Review");
            setText(refs.reorderPoint, detail.reorder_point);
            setText(refs.lastProcessed, detail.last_processed_label || "-");
            if (refs.riskPillRow) refs.riskPillRow.innerHTML = buildRiskPill(detail.risk_level, detail.stock_status);
            setText(refs.whyFlagged, detail.main_reason || detail.why_flagged || "No uploaded sales data yet.");
            if (refs.modelMeta) {
                refs.modelMeta.textContent = detail.stockout_probability_label
                    ? `${detail.model_meta || "Analysis sources: Predicted Demand · Stockout Risk"} · ${detail.stockout_probability_label}`
                    : (detail.model_meta || "Analysis sources: Predicted Demand · Stockout Risk");
            }
            setText(refs.trend, detail.trend || "Stable");
            setText(refs.suggestedAction, detail.suggested_action || "Needs Review");
            setText(refs.forecastHorizon, detail.forecast_horizon_label || "Next 7 days");
            setText(refs.modelRunTimestamp, detail.model_run_timestamp || "Latest generated results");
            setText(refs.buyerPattern, detail.buyer_behavior_pattern || "Buyer behavior pattern is not ready for this item yet.");
            setText(refs.preparationGuide, detail.stock_preparation_guide || "Review this product again after uploading more sales records.");

            if (refs.topFactors) {
                refs.topFactors.innerHTML = "";
                const factors = detail.top_factors || [];
                if (factors.length) {
                    factors.forEach((factor) => {
                        const chip = document.createElement("span");
                        chip.className = "detail-chip";
                        chip.textContent = factor;
                        refs.topFactors.appendChild(chip);
                    });
                } else {
                    const chip = document.createElement("span");
                    chip.className = "detail-chip";
                    chip.textContent = "More sales records can improve item-specific insights.";
                    refs.topFactors.appendChild(chip);
                }
            }
            setText(refs.detailNote, detail.detail_note || detail.why_flagged || "Based on uploaded sales records.");
            setText(refs.recentSalesTotal, detail.recent_sales_total ?? 0);
            setText(refs.averageDailyDemand, detail.average_daily_demand ?? 0);
            if (refs.recentSalesList) refs.recentSalesList.innerHTML = "";

            const recentPoints = detail.recent_sales_points || [];
            if (refs.recentSalesList) {
                if (recentPoints.length) {
                    recentPoints.forEach((point) => {
                        const row = document.createElement("div");
                        row.className = "recent-sales-item";
                        row.innerHTML = `<span>${point.date}</span><strong>${point.quantity}</strong>`;
                        refs.recentSalesList.appendChild(row);
                    });
                } else {
                    const row = document.createElement("div");
                    row.className = "recent-sales-item";
                    row.innerHTML = `<span>No records available yet</span><strong>—</strong>`;
                    refs.recentSalesList.appendChild(row);
                }
            }

            closeOpenDrawers("productDetailDrawer");
            drawer.classList.add("open");
            overlay.classList.add("open");
            drawer.setAttribute("aria-hidden", "false");
            overlay.setAttribute("aria-hidden", "false");
            updateDrawerBodyLock();
            requestAnimationFrame(() => buildRecentSalesChart(detail, recentPoints));
        }

        function closeDrawer() {
            drawer.classList.remove("open");
            overlay.classList.remove("open");
            drawer.setAttribute("aria-hidden", "true");
            overlay.setAttribute("aria-hidden", "true");
            updateDrawerBodyLock();
        }

        root.querySelectorAll(".product-detail-btn").forEach((button) => {
            bindOnce(button, "click", "product-detail-open", () => {
                openDrawer(button.dataset.productName);
            });
        });

        bindOnce(closeBtn, "click", "product-detail-close", closeDrawer);
        bindOnce(overlay, "click", "product-detail-overlay", closeDrawer);
    }

    function initializeAuthPage(root) {
        const authFormWrap = root.querySelector("#authFormWrap");
        const authFormStage = root.querySelector("#authFormStage");
        const authTabs = root.querySelectorAll(".auth-tab");
        const authInlineLinks = root.querySelectorAll(".auth-inline-link");
        const authFeedback = root.querySelector("#authFeedback");

        if (!(authFormWrap && authFormStage)) return;

        clearStockWisePageStates();

        if (authFormStage.dataset.authInitialized === 'true') return;
        authFormStage.dataset.authInitialized = 'true';

        function updateAuthHeight(formElement) {
            authFormWrap.style.height = `${formElement.offsetHeight}px`;
        }

        function switchAuthForm(target) {
            if (authFormStage.classList.contains("stage-hidden")) {
                authFormStage.classList.remove("stage-hidden");
                authFormWrap.classList.remove("show-none");
            }

            if (authFeedback) {
                authFeedback.classList.remove("is-visible");
                setTimeout(() => {
                    authFeedback.innerText = "";
                    authFeedback.classList.remove("is-error", "is-info");
                }, 300);
            }

            authTabs.forEach((tab) => {
                const isActive = tab.getAttribute("data-auth-target") === target;
                tab.classList.toggle("active", isActive);
                tab.setAttribute("aria-selected", isActive ? "true" : "false");
            });

            const loginForm = root.querySelector("#loginForm");
            const signupForm = root.querySelector("#signupForm");
            if (!(loginForm && signupForm)) return;

            if (target === "login") {
                signupForm.classList.remove("active-form");
                loginForm.classList.add("active-form");
                updateAuthHeight(loginForm);
            } else {
                loginForm.classList.remove("active-form");
                signupForm.classList.add("active-form");
                updateAuthHeight(signupForm);
            }
        }

        window.addEventListener("load", () => {
            const initialTarget = window.AUTH_INITIAL_FORM;
            if (!initialTarget || initialTarget === "none" || initialTarget === "None") {
                authFormWrap.style.height = "0px";
                return;
            }

            const initialForm = initialTarget === "login"
                ? root.querySelector("#loginForm")
                : root.querySelector("#signupForm");

            if (initialForm) {
                authFormWrap.style.transition = "none";
                authFormWrap.style.height = `${initialForm.offsetHeight}px`;
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        authFormWrap.style.transition = "height 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
                    }, 50);
                });
            }
        }, { once: true });

        window.addEventListener("resize", () => {
            const activeForm = root.querySelector(".auth-form.active-form");
            if (activeForm && !authFormStage.classList.contains("stage-hidden")) {
                authFormWrap.style.transition = "none";
                authFormWrap.style.height = `${activeForm.offsetHeight}px`;
                requestAnimationFrame(() => {
                    authFormWrap.style.transition = "height 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
                });
            }
        });

        authTabs.forEach((tab) => {
            tab.addEventListener("click", (event) => {
                const target = event.currentTarget.getAttribute("data-auth-target");
                switchAuthForm(target);
            });
        });

        authInlineLinks.forEach((link) => {
            link.addEventListener("click", (event) => {
                event.preventDefault();
                const target = event.currentTarget.getAttribute("data-auth-target");
                switchAuthForm(target);
            });
        });


        function setAuthFeedback(message, isError = true) {
            if (!authFeedback) return;
            authFeedback.innerText = message;
            authFeedback.classList.add("is-visible");
            authFeedback.classList.toggle("is-error", isError);
            authFeedback.classList.toggle("is-info", !isError);
        }

        function clearAuthFieldStates(form) {
            form.querySelectorAll('.auth-input.input-error').forEach((input) => input.classList.remove('input-error'));
        }

        function markAuthField(input) {
            if (input) input.classList.add('input-error');
        }

        function applyAuthValidationErrors(event, form, errors, emptyMessage) {
            if (!errors.length) return false;

            event.preventDefault();
            errors.forEach((error) => markAuthField(error.input));

            const allErrorsAreRequired = errors.every((error) => error.type === 'required');
            const message = allErrorsAreRequired && emptyMessage
                ? emptyMessage
                : errors[0].message;

            setAuthFeedback(message);
            updateAuthHeight(form);
            return true;
        }

        function isValidEmailValue(value) {
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());
        }

        function validateSignupPassword(password) {
            return password.length >= 8
                && /[A-Z]/.test(password)
                && /[a-z]/.test(password)
                && /\d/.test(password)
                && /[^A-Za-z0-9]/.test(password);
        }

        const loginFormForValidation = root.querySelector("#loginForm");
        if (loginFormForValidation && !loginFormForValidation.dataset.authValidationBound) {
            loginFormForValidation.dataset.authValidationBound = "true";
            loginFormForValidation.addEventListener("submit", (event) => {
                clearAuthFieldStates(loginFormForValidation);
                const emailInput = loginFormForValidation.querySelector('input[name="email"]');
                const passwordInput = loginFormForValidation.querySelector('input[name="password"]');
                const email = emailInput ? emailInput.value.trim() : "";
                const password = passwordInput ? passwordInput.value : "";
                const errors = [];

                if (!email) {
                    errors.push({ input: emailInput, message: "Email is required.", type: "required" });
                } else if (!isValidEmailValue(email)) {
                    errors.push({ input: emailInput, message: "Please enter a valid email address.", type: "format" });
                }

                if (!password) {
                    errors.push({ input: passwordInput, message: "Password is required.", type: "required" });
                }

                const hasLoginErrors = applyAuthValidationErrors(
                    event,
                    loginFormForValidation,
                    errors,
                    "Please enter your email and password."
                );

                if (hasLoginErrors) return;

                clearStockWisePageStates();
            });
        }

        const signupFormForValidation = root.querySelector("#signupForm");
        if (signupFormForValidation && !signupFormForValidation.dataset.authValidationBound) {
            signupFormForValidation.dataset.authValidationBound = "true";
            signupFormForValidation.addEventListener("submit", (event) => {
                clearAuthFieldStates(signupFormForValidation);
                const nameInput = signupFormForValidation.querySelector('input[name="name"]');
                const emailInput = signupFormForValidation.querySelector('input[name="email"]');
                const passwordInput = signupFormForValidation.querySelector('input[name="password"]');
                const confirmInput = signupFormForValidation.querySelector('input[name="confirm_password"]');
                const name = nameInput ? nameInput.value.trim() : "";
                const email = emailInput ? emailInput.value.trim() : "";
                const password = passwordInput ? passwordInput.value : "";
                const confirmPassword = confirmInput ? confirmInput.value : "";
                const errors = [];

                if (!name) {
                    errors.push({ input: nameInput, message: "Full name is required.", type: "required" });
                }

                if (!email) {
                    errors.push({ input: emailInput, message: "Email is required.", type: "required" });
                } else if (!isValidEmailValue(email)) {
                    errors.push({ input: emailInput, message: "Please enter a valid email address.", type: "format" });
                }

                if (!password) {
                    errors.push({ input: passwordInput, message: "Password is required.", type: "required" });
                }

                if (!confirmPassword) {
                    errors.push({ input: confirmInput, message: "Please confirm your password.", type: "required" });
                }

                if (password && !validateSignupPassword(password)) {
                    errors.push({
                        input: passwordInput,
                        message: "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.",
                        type: "format"
                    });
                }

                if (password && confirmPassword && password !== confirmPassword) {
                    errors.push({ input: confirmInput, message: "Passwords do not match.", type: "match" });
                }

                applyAuthValidationErrors(
                    event,
                    signupFormForValidation,
                    errors,
                    "Please complete all required fields before signing up."
                );
            });
        }

        root.querySelectorAll('.auth-input').forEach((input) => {
            input.addEventListener('input', () => input.classList.remove('input-error'));
        });

        initializePasswordToggles(root);
    }

    async function loadPageContent(url, options = {}) {
        const pageContent = document.getElementById("page-content");
        if (!pageContent) {
            window.location.href = url;
            return false;
        }

        closeTopbarDropdowns();
        const requestId = ++navigationRequestId;
        if (activeNavigationController) {
            activeNavigationController.abort();
        }
        activeNavigationController = new AbortController();

        closeHelpSurfaces();
        closeOpenDrawers();
        pageContent.classList.add("content-transitioning");
        pageContent.setAttribute("aria-busy", "true");
        setNavigationLoadingVisible(false);

        try {
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "X-Requested-With": "XMLHttpRequest",
                    "Accept": "text/html",
                },
                credentials: "same-origin",
                signal: activeNavigationController.signal,
                ...options,
            });

            if (!response.ok) {
                throw new Error(`Failed to load page: ${response.status}`);
            }

            const html = await response.text();
            if (requestId !== navigationRequestId) return false;

            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const incomingContent = doc.getElementById("page-content");

            if (!incomingContent) {
                window.location.href = url;
                return false;
            }

            const authGate = doc.body?.dataset?.authenticated;
            if (authGate === "false" && document.body.dataset.authenticated === "true") {
                window.location.href = url;
                return false;
            }

            destroyManagedCharts();

            pageContent.innerHTML = incomingContent.innerHTML;
            document.body.classList.remove("drawer-open");
            if (authGate) document.body.dataset.authenticated = authGate;
            pageContent.dataset.pagePath = incomingContent.dataset.pagePath || new URL(url, window.location.origin).pathname;
            document.title = doc.title || document.title;

            syncActiveNav(url);
            initializePage(pageContent);
            playPageEnterTransition(pageContent);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return true;
        } catch (error) {
            if (error.name !== "AbortError") {
                window.location.href = url;
            }
            return false;
        } finally {
            if (requestId === navigationRequestId) {
                setNavigationLoadingVisible(false);
                pageContent.classList.remove("content-transitioning");
                pageContent.removeAttribute("aria-busy");
            }
        }
    }

    function normalizeNavPath(pathname) {
        if (pathname === "/" || pathname === "/dashboard") return "dashboard";
        if (pathname === "/upload_data") return "upload_data";
        if (pathname === "/insights" || pathname === "/demand_forecast" || pathname === "/stock_risk") return "insights";
        if (pathname === "/products" || pathname === "/product_list") return "products";
        if (pathname === "/reports") return "reports";
        if (["/settings", "/team_access", "/data_management", "/activity_logs"].includes(pathname)) return "settings";
        if (pathname === "/first_time_setup") return "first_time_setup";
        return pathname.replace(/^\//, "");
    }


    function getUrlPath(value) {
        try {
            return new URL(value || window.location.href, window.location.origin).pathname;
        } catch (error) {
            return window.location.pathname;
        }
    }

    function getCurrentPageKey(root = document) {
        const pageContent = root.id === "page-content" ? root : document.getElementById("page-content");
        const pagePath = pageContent?.dataset?.pagePath || window.location.pathname;
        return normalizeNavPath(getUrlPath(pagePath));
    }

    function resolveRememberedSidebarUrl(targetUrl, targetKey) {
        if (targetUrl.search || targetUrl.hash) return targetUrl;
        if (targetKey !== "insights") return targetUrl;

        const savedState = readPageState("insights");
        const savedTab = savedState.tab === "risk" ? "risk" : savedState.tab === "forecast" ? "forecast" : "";
        if (!savedTab) return targetUrl;

        const nextUrl = new URL(targetUrl.toString());
        nextUrl.searchParams.set("tab", savedTab);
        return nextUrl;
    }

    function syncActiveNav(url) {
        const target = new URL(url, window.location.origin);
        const targetKey = normalizeNavPath(target.pathname);

        document.querySelectorAll(".sidebar-nav .nav-link[data-app-link='true']").forEach((link) => {
            const linkKey = link.dataset.navKey || normalizeNavPath(new URL(link.href, window.location.origin).pathname);
            link.classList.toggle("active", linkKey === targetKey);
        });
    }

    function cancelSettingsSectionEdit(section) {
        if (!section) return;
        section.querySelectorAll('[data-section-field]').forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(field.dataset || {}, 'originalValue')) {
                field.value = field.dataset.originalValue || '';
            }
            field.disabled = true;
        });
        section.querySelectorAll('[data-image-preview-target]').forEach((preview) => {
            if (preview.dataset.originalSrc) {
                preview.setAttribute('src', preview.dataset.originalSrc);
            }
        });
        section.classList.remove('is-editing', 'is-saving');
        const editButton = section.querySelector('[data-settings-edit]');
        const editActions = section.querySelector('.settings-edit-actions');
        const saveButton = section.querySelector('[data-settings-save]');
        if (editButton) editButton.hidden = false;
        if (editActions) editActions.hidden = true;
        if (saveButton) saveButton.disabled = true;
    }

    function openSettingsSectionFromHash(root = document) {
        const rawSectionKey = (window.location.hash || '').replace('#', '').trim();
        if (!rawSectionKey) return;
        const sectionAliases = {
            profile: 'profile-account',
            store: 'store-information',
            employees: 'team-access',
            activity: 'activity-logs',
            security: 'password-security',
            'data-format': 'sales-file-setup',
            upload: 'reports-display',
            reports: 'reports-display'
        };
        const sectionKey = sectionAliases[rawSectionKey] || rawSectionKey;

        const settingsRoot = root.querySelector?.('#settingsForm') ? root : document;
        const settingsForm = settingsRoot.querySelector?.('#settingsForm');
        if (!settingsForm) return;

        const targetItem = settingsForm.querySelector(`[data-settings-section-key="${sectionKey}"]`);
        if (!targetItem) return;

        settingsForm.querySelectorAll('[data-settings-accordion-item]').forEach((item) => {
            if (item !== targetItem && item.classList.contains('is-editing')) {
                cancelSettingsSectionEdit(item);
            }
            const trigger = item.querySelector('[data-settings-accordion-trigger]');
            const panel = item.querySelector('[data-settings-accordion-panel]');
            const isOpen = item === targetItem;
            item.classList.toggle('is-open', isOpen);
            if (trigger) trigger.setAttribute('aria-expanded', String(isOpen));
            if (panel) {
                panel.hidden = !isOpen;
                panel.setAttribute('aria-hidden', String(!isOpen));
                panel.inert = !isOpen;
                panel.style.setProperty('--settings-panel-height', isOpen ? `${panel.scrollHeight + 42}px` : '0px');
            }
        });

        targetItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function setupPersistentNavigation(root) {
        if (root.__stockwiseNavBound) return;
        root.__stockwiseNavBound = true;

        root.addEventListener("click", async (event) => {
            const link = event.target.closest("a[data-app-link='true']");
            if (!link) return;

            const href = link.getAttribute("href");
            if (!href || link.target === "_blank" || link.hasAttribute("download")) return;
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            let targetUrl = new URL(href, window.location.origin);
            const currentUrl = new URL(window.location.href);
            if (targetUrl.origin !== currentUrl.origin) return;

            const targetKey = normalizeNavPath(targetUrl.pathname);
            const currentKey = normalizeNavPath(currentUrl.pathname);
            const isPersistentNavLink = !!link.closest(".sidebar-nav") || link.classList.contains("brand");
            if (isPersistentNavLink) {
                targetUrl = resolveRememberedSidebarUrl(targetUrl, targetKey);
            }

            if (isPersistentNavLink && targetKey === currentKey) {
                event.preventDefault();
                closeTopbarDropdowns();
                if (targetKey === "settings" && !targetUrl.hash && !targetUrl.search) {
                    window.history.pushState({ path: targetUrl.toString() }, "", targetUrl.toString());
                    initializeSettingsPage(document.getElementById("page-content") || document);
                    playPageEnterTransition(document.getElementById("page-content"));
                }
                return;
            }

            const samePath = targetUrl.pathname === currentUrl.pathname;
            const sameSearch = targetUrl.search === currentUrl.search;
            const sameHash = targetUrl.hash === currentUrl.hash;
            if (samePath && sameSearch && sameHash) {
                event.preventDefault();
                return;
            }

            if (samePath && sameSearch && targetUrl.hash) {
                event.preventDefault();
                closeTopbarDropdowns();
                window.history.pushState({ path: targetUrl.toString() }, "", targetUrl.toString());
                openSettingsSectionFromHash(document);
                playPageEnterTransition(document.getElementById("page-content"));
                return;
            }

            event.preventDefault();
            const loaded = await loadPageContent(targetUrl.toString());
            if (loaded) {
                window.history.pushState({ path: targetUrl.toString() }, "", targetUrl.toString());
                if (targetUrl.hash) {
                    openSettingsSectionFromHash(document.getElementById('page-content') || document);
                    playPageEnterTransition(document.getElementById("page-content"));
                }
            }
        });

        window.addEventListener("popstate", async () => {
            await loadPageContent(window.location.href);
        });
    }


    function isStrongPasswordValue(password) {
        return (password || "").length >= 8
            && /[A-Z]/.test(password)
            && /[a-z]/.test(password)
            && /\d/.test(password)
            && /[^A-Za-z0-9]/.test(password);
    }

    function initializeImagePreviews(root) {
        const inputs = Array.from(root.querySelectorAll('[data-image-preview-input]'));
        inputs.forEach((input) => {
            if (input.dataset.previewBound === 'true') return;
            input.dataset.previewBound = 'true';

            input.addEventListener('change', () => {
                const targetKey = input.dataset.previewTarget;
                if (!targetKey || !input.files || !input.files[0]) return;

                const target = root.querySelector(`[data-image-preview-target="${targetKey}"]`) || document.querySelector(`[data-image-preview-target="${targetKey}"]`);
                if (!target) return;

                const file = input.files[0];
                const objectUrl = URL.createObjectURL(file);
                target.src = objectUrl;
                target.onload = () => URL.revokeObjectURL(objectUrl);
            });
        });
    }

    function initializeOnboardingPage(root) {
        initializeImagePreviews(root);

        const roleSelect = root.querySelector('[data-setup-role-select]');
        const roleHelp = root.querySelector('[data-setup-role-help]');
        if (roleSelect && roleHelp && roleSelect.dataset.roleHelpBound !== 'true') {
            roleSelect.dataset.roleHelpBound = 'true';
            const updateRoleHelp = () => {
                roleHelp.textContent = roleSelect.value === 'Owner'
                    ? 'Owner has full access to settings, uploads, reports, team access, and data management.'
                    : 'Employee account selected. Employee roles are limited to Store Manager or Operational Assistant.';
            };
            roleSelect.addEventListener('change', updateRoleHelp);
            updateRoleHelp();
        }

        const logoChoice = root.querySelector('[data-logo-choice]');
        const logoPanel = root.querySelector('[data-logo-upload-panel]');
        if (logoChoice && logoPanel && logoChoice.dataset.logoChoiceBound !== 'true') {
            logoChoice.dataset.logoChoiceBound = 'true';
            const updateLogoPanel = () => {
                const selected = logoChoice.querySelector('input[name="has_store_logo"]:checked')?.value || '';
                const shouldShowLogoUpload = selected === 'yes';
                logoPanel.classList.toggle('is-visible', shouldShowLogoUpload);
                logoPanel.setAttribute('aria-hidden', shouldShowLogoUpload ? 'false' : 'true');
            };
            logoChoice.addEventListener('change', updateLogoPanel);
            updateLogoPanel();
        }

        const firstUploadInput = root.querySelector('[data-onboarding-upload-input]');
        const firstUploadForm = root.querySelector('[data-onboarding-upload-form]');
        if (firstUploadInput && firstUploadForm && firstUploadInput.dataset.onboardingUploadBound !== 'true') {
            firstUploadInput.dataset.onboardingUploadBound = 'true';
            firstUploadInput.addEventListener('change', () => {
                if (firstUploadInput.files && firstUploadInput.files.length > 0) {
                    firstUploadForm.submit();
                }
            });
            ['dragenter', 'dragover'].forEach((eventName) => {
                firstUploadForm.addEventListener(eventName, (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
                    firstUploadForm.classList.add('dragover');
                });
            });
            ['dragleave', 'drop'].forEach((eventName) => {
                firstUploadForm.addEventListener(eventName, (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    firstUploadForm.classList.remove('dragover');
                });
            });
            firstUploadForm.addEventListener('drop', (event) => {
                const files = event.dataTransfer?.files;
                if (!files || files.length === 0) return;
                try {
                    const transfer = new DataTransfer();
                    transfer.items.add(files[0]);
                    firstUploadInput.files = transfer.files;
                    firstUploadForm.submit();
                } catch (error) {
                    firstUploadInput.click();
                    showStockWiseToast('Drag-and-drop is restricted in this browser. Please use Choose File.', 'warning');
                }
            });
        }
    }

    function initializeLogoutConfirmation(root = document) {
        if (document.body.dataset.logoutConfirmBound === 'true') return;
        document.body.dataset.logoutConfirmBound = 'true';

        const { overlay, confirmLink, cancelButton } = getLogoutConfirmationElements();

        function handleLogoutConfirmClick(event) {
            const logoutLink = event.target.closest('[data-confirm-logout]');
            if (logoutLink) {
                if (logoutLink.closest('#accountDropdown')) return;

                const logoutUrl = logoutLink.getAttribute('data-logout-url') || logoutLink.getAttribute('href') || '/logout';
                if (!openLogoutConfirmation(logoutUrl)) return;

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                return;
            }

            if (event.target === overlay) {
                closeLogoutConfirmation();
            }
        }

        document.addEventListener('click', handleLogoutConfirmClick, true);
        bindOnce(confirmLink, 'click', 'logout-clear-page-states', () => {
            clearStockWisePageStates();
        });
        cancelButton?.addEventListener('click', closeLogoutConfirmation);
        document.addEventListener('keydown', (event) => {
            const { overlay: activeOverlay } = getLogoutConfirmationElements();
            if (event.key === 'Escape' && activeOverlay && !activeOverlay.hidden) closeLogoutConfirmation();
        });
    }

    function initializeStockWiseToasts(root = document) {
        const toastRoot = root && root.querySelectorAll ? root : document;
        const toasts = toastRoot.querySelectorAll('[data-auto-dismiss-toast]');
        toasts.forEach((toast) => {
            if (toast.dataset.toastBound === 'true') return;
            toast.dataset.toastBound = 'true';
            window.setTimeout(() => {
                toast.classList.add('is-hiding');
                window.setTimeout(() => {
                    const layer = toast.closest('.settings-toast-layer');
                    toast.remove();
                    if (layer && !layer.querySelector('[data-auto-dismiss-toast]')) {
                        layer.remove();
                    }
                }, 320);
            }, 3500);
        });
    }

    function showStockWiseToast(message, type = 'error') {
        const cleanMessage = String(message || '').trim();
        if (!cleanMessage) return;

        let layer = document.querySelector('.settings-toast-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.className = 'settings-toast-layer';
            layer.setAttribute('aria-live', 'polite');
            document.body.appendChild(layer);
        }

        const toast = document.createElement('div');
        toast.className = `settings-toast status-alert status-${type}`;
        toast.dataset.autoDismissToast = 'true';
        toast.textContent = cleanMessage;
        layer.appendChild(toast);
        initializeStockWiseToasts(document);
    }

    function initializePasswordToggles(root = document) {
        const toggleInputs = root.querySelectorAll('.password-container input[type="password"], .password-container input[type="text"]');
        toggleInputs.forEach((input) => {
            const icon = input.nextElementSibling;
            if (!(icon && icon.classList.contains('toggle-password'))) return;
            if (input.dataset.passwordToggleBound === 'true') {
                icon.classList.toggle('hidden', input.value.length === 0);
                return;
            }
            input.dataset.passwordToggleBound = 'true';

            const syncIcon = () => {
                icon.classList.toggle('hidden', input.value.length === 0);
            };

            input.addEventListener('input', syncIcon);
            input.addEventListener('focus', syncIcon);
            input.addEventListener('blur', syncIcon);
            syncIcon();
        });

        root.querySelectorAll('.toggle-password').forEach((icon) => {
            if (icon.dataset.toggleBound === 'true') return;
            icon.dataset.toggleBound = 'true';

            icon.addEventListener('click', (event) => {
                event.preventDefault();
                const input = icon.previousElementSibling;
                if (!input) return;

                const showing = input.getAttribute('type') === 'text';
                input.setAttribute('type', showing ? 'password' : 'text');
                icon.classList.toggle('fa-eye', showing);
                icon.classList.toggle('fa-eye-slash', !showing);
                input.focus();
            });
        });
    }

    function resetPasswordToggleState(root = document) {
        root.querySelectorAll('.password-container').forEach((container) => {
            const input = container.querySelector('input');
            const icon = container.querySelector('.toggle-password');
            if (!input || !icon) return;

            input.setAttribute('type', 'password');
            icon.classList.add('hidden');
            icon.classList.add('fa-eye');
            icon.classList.remove('fa-eye-slash');
        });
    }


    function cleanupDetachedEnhancedSelects() {
        document.querySelectorAll('.sw-enhanced-select-menu[data-enhanced-select-owner]').forEach((menu) => {
            const ownerId = menu.dataset.enhancedSelectOwner;
            if (!ownerId || !document.querySelector(`select[data-enhanced-select-id="${ownerId}"]`)) {
                menu.remove();
            }
        });
    }

    function closeEnhancedSelect(wrapper) {
        if (!wrapper) return;
        const menu = wrapper.__swEnhancedMenu || document.querySelector(`.sw-enhanced-select-menu[data-enhanced-select-owner="${wrapper.dataset.enhancedSelectId || ''}"]`);
        const trigger = wrapper.querySelector('[data-enhanced-select-trigger]');
        if (wrapper.__swEnhancedCloseTimer) {
            window.clearTimeout(wrapper.__swEnhancedCloseTimer);
            wrapper.__swEnhancedCloseTimer = null;
        }
        if (menu) {
            menu.classList.remove('is-visible');
            wrapper.__swEnhancedCloseTimer = window.setTimeout(() => {
                if (!wrapper.classList.contains('is-open')) {
                    menu.hidden = true;
                }
                wrapper.__swEnhancedCloseTimer = null;
            }, 180);
        }
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        wrapper.classList.remove('is-open');
    }

    function closeAllEnhancedSelects(exceptWrapper = null) {
        document.querySelectorAll('[data-enhanced-select]').forEach((wrapper) => {
            if (wrapper !== exceptWrapper) closeEnhancedSelect(wrapper);
        });
    }

    function repositionOpenEnhancedSelects() {
        document.querySelectorAll('[data-enhanced-select].is-open').forEach((wrapper) => {
            positionEnhancedSelectMenu(wrapper);
        });
    }

    function positionEnhancedSelectMenu(wrapper) {
        if (!wrapper) return;
        const trigger = wrapper.querySelector('[data-enhanced-select-trigger]');
        const menu = wrapper.__swEnhancedMenu;
        if (!(trigger && menu)) return;

        const rect = trigger.getBoundingClientRect();
        const viewportGap = 10;
        const menuWidth = Math.max(rect.width, 180);

        menu.style.minWidth = `${menuWidth}px`;
        menu.style.maxHeight = '';
        menu.style.overflowY = 'hidden';
        menu.classList.remove('has-scroll');

        const naturalHeight = Math.ceil(menu.scrollHeight || 0);
        const preferredHeight = naturalHeight || 180;
        const availableBelow = window.innerHeight - rect.bottom - viewportGap;
        const availableAbove = rect.top - viewportGap;
        const shouldOpenAbove = availableBelow < Math.min(preferredHeight, 180) && availableAbove > availableBelow;
        const availableSpace = Math.max(120, (shouldOpenAbove ? availableAbove : availableBelow) - 6);
        const cappedHeight = Math.min(preferredHeight, availableSpace, 280);
        const needsScroll = preferredHeight > cappedHeight + 2;
        const menuHeight = needsScroll ? cappedHeight : preferredHeight;

        const maxLeft = Math.max(viewportGap, window.innerWidth - menuWidth - viewportGap);
        const left = Math.min(Math.max(viewportGap, rect.left), maxLeft);
        const top = shouldOpenAbove
            ? Math.max(viewportGap, rect.top - menuHeight - 6)
            : Math.min(window.innerHeight - menuHeight - viewportGap, rect.bottom + 6);

        menu.style.minWidth = `${menuWidth}px`;
        menu.style.maxHeight = needsScroll ? `${menuHeight}px` : 'none';
        menu.style.overflowY = needsScroll ? 'auto' : 'hidden';
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.dataset.placement = shouldOpenAbove ? 'top' : 'bottom';
        menu.classList.toggle('has-scroll', needsScroll);
    }

    function refreshEnhancedSelect(select) {
        const api = select?.__swEnhancedSelect;
        if (api && typeof api.refresh === 'function') api.refresh();
    }

    function shouldEnhanceSelect(select) {
        if (!select || select.tagName !== 'SELECT') return false;
        if (select.multiple || Number(select.getAttribute('size') || '1') > 1) return false;
        if (select.dataset.nativeSelect === 'true' || select.dataset.enhanceSelect === 'false') return false;
        if (select.closest('[data-user-filter]')) return false;
        return true;
    }

    function initializeEnhancedSelects(root = document) {
        cleanupDetachedEnhancedSelects();
        const scope = root && root.querySelectorAll ? root : document;
        const selects = scope.querySelectorAll('select:not([multiple])');

        selects.forEach((select) => {
            if (!shouldEnhanceSelect(select)) return;

            if (select.dataset.enhancedSelectReady === 'true') {
                refreshEnhancedSelect(select);
                return;
            }

            const enhancedId = select.dataset.enhancedSelectId || `sw-select-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            select.dataset.enhancedSelectId = enhancedId;
            select.dataset.enhancedSelectReady = 'true';
            if (!Object.prototype.hasOwnProperty.call(select.dataset, 'originalTabIndex')) {
                select.dataset.originalTabIndex = select.getAttribute('tabindex') || '';
            }
            select.classList.add('sw-native-select-hidden');
            select.setAttribute('tabindex', '-1');
            select.setAttribute('aria-hidden', 'true');

            const wrapper = document.createElement('div');
            wrapper.className = 'sw-enhanced-select';
            wrapper.dataset.enhancedSelect = 'true';
            wrapper.dataset.enhancedSelectId = enhancedId;
            if (select.classList.contains('compact-select')) wrapper.classList.add('sw-enhanced-select--compact');
            if (select.classList.contains('w-100')) wrapper.classList.add('w-100');

            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'sw-enhanced-select-trigger';
            trigger.dataset.enhancedSelectTrigger = 'true';
            trigger.setAttribute('aria-haspopup', 'listbox');
            trigger.setAttribute('aria-expanded', 'false');

            const valueText = document.createElement('span');
            valueText.className = 'sw-enhanced-select-value';
            trigger.appendChild(valueText);

            const arrow = document.createElement('span');
            arrow.className = 'sw-enhanced-select-arrow';
            arrow.setAttribute('aria-hidden', 'true');
            trigger.appendChild(arrow);

            const menu = document.createElement('div');
            menu.className = 'sw-enhanced-select-menu';
            menu.dataset.enhancedSelectOwner = enhancedId;
            menu.setAttribute('role', 'listbox');
            menu.hidden = true;

            wrapper.appendChild(trigger);
            select.insertAdjacentElement('afterend', wrapper);
            document.body.appendChild(menu);
            wrapper.__swEnhancedMenu = menu;

            const syncDisabledState = () => {
                const isDisabled = select.disabled;
                trigger.disabled = isDisabled;
                wrapper.classList.toggle('is-disabled', isDisabled);
                trigger.setAttribute('aria-disabled', String(isDisabled));
                if (isDisabled) closeEnhancedSelect(wrapper);
            };

            const getSelectedOption = () => select.options?.[select.selectedIndex] || select.querySelector('option');

            const syncTrigger = () => {
                const selectedOption = getSelectedOption();
                valueText.textContent = selectedOption ? selectedOption.textContent.trim() : '';
                wrapper.classList.toggle('has-value', !!(select.value || valueText.textContent));
                syncDisabledState();
                menu.querySelectorAll('[data-enhanced-option-index]').forEach((optionButton) => {
                    const isSelected = Number(optionButton.dataset.enhancedOptionIndex) === select.selectedIndex;
                    optionButton.classList.toggle('is-selected', isSelected);
                    optionButton.setAttribute('aria-selected', String(isSelected));
                });
            };

            const buildMenu = () => {
                menu.innerHTML = '';
                Array.from(select.children).forEach((child) => {
                    if (child.tagName === 'OPTGROUP') {
                        const groupLabel = document.createElement('div');
                        groupLabel.className = 'sw-enhanced-select-group-label';
                        groupLabel.textContent = child.label || '';
                        menu.appendChild(groupLabel);

                        Array.from(child.children).forEach((option) => {
                            const optionButton = document.createElement('button');
                            optionButton.type = 'button';
                            optionButton.className = 'sw-enhanced-select-option';
                            optionButton.dataset.enhancedOptionIndex = String(Array.from(select.options).indexOf(option));
                            optionButton.textContent = option.textContent;
                            optionButton.disabled = option.disabled;
                            optionButton.setAttribute('role', 'option');
                            menu.appendChild(optionButton);
                        });
                        return;
                    }

                    if (child.tagName === 'OPTION') {
                        const optionButton = document.createElement('button');
                        optionButton.type = 'button';
                        optionButton.className = 'sw-enhanced-select-option';
                        optionButton.dataset.enhancedOptionIndex = String(Array.from(select.options).indexOf(child));
                        optionButton.textContent = child.textContent;
                        optionButton.disabled = child.disabled;
                        optionButton.setAttribute('role', 'option');
                        menu.appendChild(optionButton);
                    }
                });

                if (!menu.children.length) {
                    const empty = document.createElement('div');
                    empty.className = 'sw-enhanced-select-empty';
                    empty.textContent = 'No options available';
                    menu.appendChild(empty);
                }

                syncTrigger();
            };

            const openMenu = () => {
                if (select.disabled) return;
                closeAllEnhancedSelects(wrapper);
                if (wrapper.__swEnhancedCloseTimer) {
                    window.clearTimeout(wrapper.__swEnhancedCloseTimer);
                    wrapper.__swEnhancedCloseTimer = null;
                }
                menu.hidden = false;
                menu.classList.remove('is-visible');
                wrapper.classList.add('is-open');
                trigger.setAttribute('aria-expanded', 'true');
                positionEnhancedSelectMenu(wrapper);
                requestAnimationFrame(() => {
                    positionEnhancedSelectMenu(wrapper);
                    menu.classList.add('is-visible');
                });
            };

            trigger.addEventListener('click', (event) => {
                event.preventDefault();
                if (select.disabled) return;
                if (menu.hidden || !wrapper.classList.contains('is-open')) openMenu();
                else closeEnhancedSelect(wrapper);
            });

            trigger.addEventListener('keydown', (event) => {
                if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault();
                    openMenu();
                    const selectedOption = menu.querySelector('.sw-enhanced-select-option.is-selected:not(:disabled)') || menu.querySelector('.sw-enhanced-select-option:not(:disabled)');
                    selectedOption?.focus();
                }
            });

            menu.addEventListener('click', (event) => {
                const optionButton = event.target.closest('[data-enhanced-option-index]');
                if (!optionButton || optionButton.disabled) return;

                const index = Number(optionButton.dataset.enhancedOptionIndex);
                if (!Number.isInteger(index) || index < 0 || index >= select.options.length) return;

                select.selectedIndex = index;
                syncTrigger();
                closeEnhancedSelect(wrapper);
                select.dispatchEvent(new Event('input', { bubbles: true }));
                select.dispatchEvent(new Event('change', { bubbles: true }));
                window.setTimeout(() => refreshEnhancedSelect(select), 0);
                trigger.focus();
            });

            menu.addEventListener('keydown', (event) => {
                const optionButtons = Array.from(menu.querySelectorAll('.sw-enhanced-select-option:not(:disabled)'));
                const currentIndex = optionButtons.indexOf(document.activeElement);
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeEnhancedSelect(wrapper);
                    trigger.focus();
                    return;
                }
                if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    optionButtons[Math.min(currentIndex + 1, optionButtons.length - 1)]?.focus();
                    return;
                }
                if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    optionButtons[Math.max(currentIndex - 1, 0)]?.focus();
                    return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    document.activeElement?.click();
                }
            });

            select.addEventListener('change', syncTrigger);
            select.addEventListener('input', syncTrigger);
            select.addEventListener('invalid', () => {
                window.setTimeout(() => trigger.focus(), 0);
            });

            const observer = new MutationObserver(() => {
                buildMenu();
                positionEnhancedSelectMenu(wrapper);
            });
            observer.observe(select, {
                attributes: true,
                childList: true,
                subtree: true,
                characterData: true,
                attributeFilter: ['disabled', 'selected', 'label']
            });

            const form = select.closest('form');
            if (form && form.dataset.enhancedSelectResetBound !== 'true') {
                form.dataset.enhancedSelectResetBound = 'true';
                form.addEventListener('reset', () => {
                    window.setTimeout(() => {
                        form.querySelectorAll('select[data-enhanced-select-ready="true"]').forEach(refreshEnhancedSelect);
                    }, 0);
                });
            }

            select.__swEnhancedSelect = {
                refresh: () => {
                    buildMenu();
                    syncTrigger();
                }
            };

            buildMenu();
        });

        if (document.body.dataset.enhancedSelectGlobalBound !== 'true') {
            document.body.dataset.enhancedSelectGlobalBound = 'true';
            document.addEventListener('click', (event) => {
                if (event.target.closest('[data-enhanced-select]') || event.target.closest('.sw-enhanced-select-menu')) return;
                closeAllEnhancedSelects();
            });
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape') closeAllEnhancedSelects();
            });
            window.addEventListener('resize', () => repositionOpenEnhancedSelects());
            window.addEventListener('scroll', (event) => {
                const target = event.target;
                if (target instanceof Element && target.closest('.sw-enhanced-select-menu')) return;
                repositionOpenEnhancedSelects();
            }, true);
        }
    }

    function initializeSettingsPage(root) {
        const settingsForm = root.querySelector('#settingsForm');
        if (!settingsForm) return;

        initializeImagePreviews(root);
        initializePasswordToggles(root);

        initializeStockWiseToasts(document);

        const accordionItems = Array.from(settingsForm.querySelectorAll('[data-settings-accordion-item]'));

        function getSectionFields(item) {
            return Array.from(item.querySelectorAll('[data-section-field]'));
        }

        function setAccordionItemState(item, isOpen) {
            if (!item) return;
            item.classList.toggle('is-open', isOpen);
            const trigger = item.querySelector('[data-settings-accordion-trigger]');
            const panel = item.querySelector('[data-settings-accordion-panel]');
            if (trigger) trigger.setAttribute('aria-expanded', String(isOpen));
            if (panel) {
                panel.hidden = !isOpen;
                panel.setAttribute('aria-hidden', String(!isOpen));
                panel.inert = !isOpen;
                const height = isOpen ? `${panel.scrollHeight + 42}px` : '0px';
                panel.style.setProperty('--settings-panel-height', height);
            }
        }

        function openAccordionItem(item) {
            accordionItems.forEach((candidate) => {
                if (candidate !== item && candidate.classList.contains('is-editing')) {
                    restoreFieldValues(candidate);
                    setSectionEditState(candidate, false);
                }
                setAccordionItemState(candidate, candidate === item);
            });
        }

        function closeAllAccordionItems() {
            accordionItems.forEach((item) => setAccordionItemState(item, false));
        }

        function setSectionEditState(item, isEditing) {
            if (!item) return;
            item.classList.toggle('is-editing', isEditing);
            const editButton = item.querySelector('[data-settings-edit]');
            const editActions = item.querySelector('.settings-edit-actions');
            const saveButton = item.querySelector('[data-settings-save]');
            getSectionFields(item).forEach((field) => {
                field.disabled = !isEditing;
            });
            if (editButton) editButton.hidden = isEditing;
            if (editActions) editActions.hidden = !isEditing;
            if (saveButton) saveButton.disabled = !isEditing;
            if (item.classList.contains('is-open')) {
                const panel = item.querySelector('[data-settings-accordion-panel]');
                if (panel) {
                    const updatePanelHeight = () => panel.style.setProperty('--settings-panel-height', `${panel.scrollHeight + 42}px`);
                    requestAnimationFrame(updatePanelHeight);
                    window.setTimeout(updatePanelHeight, 300);
                }
            }
        }

        function rememberFieldValues(item) {
            getSectionFields(item).forEach((field) => {
                field.dataset.originalValue = field.value || '';
            });
            item.querySelectorAll('[data-image-preview-target]').forEach((preview) => {
                preview.dataset.originalSrc = preview.getAttribute('src') || '';
            });
        }

        function restoreFieldValues(item) {
            getSectionFields(item).forEach((field) => {
                if (Object.prototype.hasOwnProperty.call(field.dataset, 'originalValue')) {
                    field.value = field.dataset.originalValue;
                }
            });
            item.querySelectorAll('[data-image-preview-target]').forEach((preview) => {
                if (preview.dataset.originalSrc) {
                    preview.setAttribute('src', preview.dataset.originalSrc);
                }
            });
            resetPasswordToggleState(item);
        }

        function enableAllSettingsFieldsForSubmit() {
            settingsForm.querySelectorAll('[data-section-field]').forEach((field) => {
                field.disabled = false;
            });
        }

        function showFeedback(message) {
            showStockWiseToast(message, 'error');
        }

        function hideFeedback() {
            // Client-side Settings errors are displayed as auto-dismiss toasts.
        }

        closeAllAccordionItems();
        accordionItems.forEach((item) => {
            rememberFieldValues(item);
            setSectionEditState(item, false);
        });

        const targetSectionKey = (window.location.hash || '').replace('#', '').trim();
        if (targetSectionKey) {
            const matchedItem = accordionItems.find((item) => item.dataset.settingsSectionKey === targetSectionKey);
            if (matchedItem) openAccordionItem(matchedItem);
        }

        if (settingsForm.dataset.settingsAccordionBound !== 'true') {
            settingsForm.dataset.settingsAccordionBound = 'true';

            accordionItems.forEach((item) => {
                const trigger = item.querySelector('[data-settings-accordion-trigger]');
                const editButton = item.querySelector('[data-settings-edit]');
                const cancelButton = item.querySelector('[data-settings-cancel]');

                if (trigger) {
                    trigger.addEventListener('click', () => {
                        const shouldOpen = !item.classList.contains('is-open');
                        if (shouldOpen) {
                            openAccordionItem(item);
                        } else {
                            if (item.classList.contains('is-editing')) {
                                restoreFieldValues(item);
                                setSectionEditState(item, false);
                            }
                            setAccordionItemState(item, false);
                        }
                    });
                }

                if (editButton) {
                    editButton.addEventListener('click', () => {
                        hideFeedback();
                        openAccordionItem(item);
                        setSectionEditState(item, true);
                    });
                }

                if (cancelButton) {
                    cancelButton.addEventListener('click', () => {
                        hideFeedback();
                        restoreFieldValues(item);
                        setSectionEditState(item, false);
                    });
                }
            });

            settingsForm.addEventListener('invalid', (event) => {
                const invalidItem = event.target.closest?.('[data-settings-accordion-item]');
                if (invalidItem) {
                    openAccordionItem(invalidItem);
                    setSectionEditState(invalidItem, true);
                }
            }, true);
        }

        if (settingsForm.dataset.settingsValidationBound === 'true') return;
        settingsForm.dataset.settingsValidationBound = 'true';

        settingsForm.addEventListener('input', hideFeedback);
        settingsForm.addEventListener('change', hideFeedback);

        settingsForm.addEventListener('submit', (event) => {
            hideFeedback();
            const submitter = event.submitter;
            const submittedItem = submitter?.closest?.('[data-settings-accordion-item]');
            const currentPassword = settingsForm.querySelector('input[name="current_password"]')?.value || '';
            const newPassword = settingsForm.querySelector('input[name="new_password"]')?.value || '';
            const confirmPassword = settingsForm.querySelector('input[name="confirm_password"]')?.value || '';
            const securityField = settingsForm.querySelector('input[name="new_password"]');
            const securityItem = securityField?.closest?.('[data-settings-accordion-item]');
            const isSecuritySave = submitter?.getAttribute('name') === 'settings_section' && submitter?.value === 'security';

            if (submitter && submitter.matches('[data-employee-action]')) {
                const employeeItem = submitter.closest?.('[data-settings-accordion-item]');
                if (employeeItem) {
                    getSectionFields(employeeItem).forEach((field) => { field.disabled = false; });
                }
                return;
            }

            if (!submitter || !submitter.matches('[data-settings-save]')) {
                event.preventDefault();
                showFeedback('Open a section and click Edit before saving changes.');
                return;
            }

            if (isSecuritySave || currentPassword || newPassword || confirmPassword) {
                if (!currentPassword) {
                    event.preventDefault();
                    if (securityItem) {
                        openAccordionItem(securityItem);
                        setSectionEditState(securityItem, true);
                    }
                    showFeedback('Please enter your current password before setting a new password.');
                    return;
                }
                if (!newPassword) {
                    event.preventDefault();
                    if (securityItem) {
                        openAccordionItem(securityItem);
                        setSectionEditState(securityItem, true);
                    }
                    showFeedback('Please enter your new password.');
                    return;
                }
                if (!confirmPassword) {
                    event.preventDefault();
                    if (securityItem) {
                        openAccordionItem(securityItem);
                        setSectionEditState(securityItem, true);
                    }
                    showFeedback('Please confirm your new password.');
                    return;
                }
                if (!isStrongPasswordValue(newPassword)) {
                    event.preventDefault();
                    if (securityItem) {
                        openAccordionItem(securityItem);
                        setSectionEditState(securityItem, true);
                    }
                    showFeedback('Password must be at least 8 characters and include uppercase, lowercase, number, and special character.');
                    return;
                }
                if (newPassword !== confirmPassword) {
                    event.preventDefault();
                    if (securityItem) {
                        openAccordionItem(securityItem);
                        setSectionEditState(securityItem, true);
                    }
                    showFeedback('New password and confirmation do not match.');
                    return;
                }
            }

            enableAllSettingsFieldsForSubmit();
            if (submitter) {
                submitter.disabled = true;
                submitter.classList.add('is-disabled');
                submitter.textContent = 'Saving...';
            }
            if (submittedItem) {
                submittedItem.classList.add('is-saving');
            }
        });
    }

    function initializeActivityUserFilter(root = document) {
        const filters = root.querySelectorAll('[data-user-filter]');
        filters.forEach((filter) => {
            if (filter.dataset.userFilterBound === 'true') return;
            filter.dataset.userFilterBound = 'true';

            const trigger = filter.querySelector('[data-user-filter-trigger]');
            const menu = filter.querySelector('[data-user-filter-menu]');
            const label = filter.querySelector('[data-user-filter-label]');
            const form = filter.closest('form') || root.querySelector('form.activity-filter-form');
            const hiddenId = form?.querySelector('[data-user-filter-value]');
            const hiddenName = form?.querySelector('[data-user-filter-name]');

            const closeSubmenus = (except = null) => {
                filter.querySelectorAll('.activity-user-filter-submenu').forEach((submenu) => {
                    if (submenu !== except) submenu.hidden = true;
                });
                filter.querySelectorAll('.activity-user-filter-group-button').forEach((button) => {
                    const submenu = button.parentElement?.querySelector('.activity-user-filter-submenu');
                    button.setAttribute('aria-expanded', String(submenu && !submenu.hidden));
                });
            };

            const closeMenu = () => {
                if (menu) menu.hidden = true;
                if (trigger) trigger.setAttribute('aria-expanded', 'false');
                closeSubmenus();
            };

            trigger?.addEventListener('click', (event) => {
                event.preventDefault();
                const willOpen = !!menu?.hidden;
                if (menu) menu.hidden = !willOpen;
                trigger.setAttribute('aria-expanded', String(willOpen));
                if (!willOpen) closeSubmenus();
            });

            filter.querySelectorAll('[data-user-filter-group]').forEach((group) => {
                const button = group.querySelector('.activity-user-filter-group-button');
                const submenu = group.querySelector('.activity-user-filter-submenu');
                if (!(button && submenu)) return;

                button.addEventListener('mouseenter', () => {
                    closeSubmenus(submenu);
                    submenu.hidden = false;
                    button.setAttribute('aria-expanded', 'true');
                });

                button.addEventListener('click', (event) => {
                    event.preventDefault();
                    const willOpen = submenu.hidden;
                    closeSubmenus();
                    submenu.hidden = !willOpen;
                    button.setAttribute('aria-expanded', String(willOpen));
                });
            });

            filter.querySelectorAll('[data-user-option]').forEach((option) => {
                option.addEventListener('click', (event) => {
                    event.preventDefault();
                    const userId = option.dataset.userId || '';
                    const userName = option.dataset.userName || '';

                    if (hiddenId) hiddenId.value = userId;
                    if (hiddenName) hiddenName.value = userName;
                    if (label) label.textContent = userName || 'All users';
                    closeMenu();
                });
            });
        });

        if (document.body.dataset.activityUserFilterOutsideBound !== 'true') {
            document.body.dataset.activityUserFilterOutsideBound = 'true';
            document.addEventListener('click', (event) => {
                document.querySelectorAll('[data-user-filter]').forEach((filter) => {
                    if (filter.contains(event.target)) return;
                    const menu = filter.querySelector('[data-user-filter-menu]');
                    const trigger = filter.querySelector('[data-user-filter-trigger]');
                    if (menu) menu.hidden = true;
                    if (trigger) trigger.setAttribute('aria-expanded', 'false');
                    filter.querySelectorAll('.activity-user-filter-submenu').forEach((submenu) => {
                        submenu.hidden = true;
                    });
                    filter.querySelectorAll('.activity-user-filter-group-button').forEach((button) => {
                        button.setAttribute('aria-expanded', 'false');
                    });
                });
            });
            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                document.querySelectorAll('[data-user-filter-menu]').forEach((menu) => {
                    menu.hidden = true;
                });
                document.querySelectorAll('[data-user-filter-trigger]').forEach((trigger) => {
                    trigger.setAttribute('aria-expanded', 'false');
                });
                document.querySelectorAll('.activity-user-filter-submenu').forEach((submenu) => {
                    submenu.hidden = true;
                });
            });
        }
    }

    function playActivityLogsTableTransition(root = document) {
        const target = root.querySelector(".activity-log-card") || root.querySelector(".activity-log-table-shell");
        if (!target) return;

        target.classList.remove("is-refreshing", "content-entering");
        void target.offsetWidth;
        target.classList.add("content-entering");

        window.setTimeout(() => {
            target.classList.remove("content-entering");
        }, 240);
    }

    function initializeActivityLogTransitions(root = document) {
        const form = root.querySelector("form.activity-filter-form, form[data-activity-filter-form]");
        const tableCard = root.querySelector(".activity-log-card") || root.querySelector(".activity-log-table-shell");
        if (!form || form.dataset.activityTransitionBound === "true") return;
        form.dataset.activityTransitionBound = "true";
        form.addEventListener("submit", () => {
            tableCard?.classList.add("is-refreshing");
        });
    }

    function initializeActivityLogsPage(root = document) {
        initializeActivityUserFilter(root);
        initializeActivityLogTransitions(root);
        playActivityLogsTableTransition(root);

        const dateRangeSelect = root.querySelector('[data-date-range-select]');
        const customDateModal = root.querySelector('[data-custom-date-modal]') || document.querySelector('[data-custom-date-modal]');
        if (!(dateRangeSelect && customDateModal) || dateRangeSelect.dataset.dateRangeBound === 'true') return;

        document.querySelectorAll('body > [data-custom-date-modal]').forEach((modal) => {
            if (modal !== customDateModal) modal.remove();
        });
        if (customDateModal.parentElement !== document.body) {
            document.body.appendChild(customDateModal);
        }

        dateRangeSelect.dataset.dateRangeBound = 'true';
        const cancelButtons = customDateModal.querySelectorAll('[data-custom-date-cancel]');
        const applyButton = customDateModal.querySelector('[data-custom-date-apply]');
        const firstDateInput = customDateModal.querySelector('input[name="date_from"]');
        const lastDateInput = customDateModal.querySelector('input[name="date_to"]');
        const customOption = dateRangeSelect.querySelector('option[value="custom"]');
        let previousDateRange = dateRangeSelect.value || 'all';
        let appliedCustomRange = dateRangeSelect.value === 'custom' && !!(firstDateInput?.value && lastDateInput?.value);

        const updateCustomDateLabel = () => {
            const fromValue = firstDateInput?.value || '';
            const toValue = lastDateInput?.value || '';
            if (customOption) {
                customOption.textContent = fromValue && toValue ? `Custom: ${fromValue} to ${toValue}` : 'Custom range';
            }
            refreshEnhancedSelect(dateRangeSelect);
        };

        const restorePreviousDateRange = () => {
            if (!appliedCustomRange) {
                dateRangeSelect.value = previousDateRange && previousDateRange !== 'custom' ? previousDateRange : 'all';
                updateCustomDateLabel();
            }
        };

        const openCustomDateModal = () => {
            customDateModal.hidden = false;
            customDateModal.setAttribute('aria-hidden', 'false');
            document.body.classList.add('modal-open');
            requestAnimationFrame(() => {
                customDateModal.classList.add('is-visible');
                firstDateInput?.focus();
            });
        };

        const closeCustomDateModal = () => {
            customDateModal.classList.remove('is-visible');
            customDateModal.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('modal-open');
            window.setTimeout(() => {
                if (!customDateModal.classList.contains('is-visible')) customDateModal.hidden = true;
            }, 180);
        };

        updateCustomDateLabel();

        dateRangeSelect.addEventListener('focus', () => {
            previousDateRange = dateRangeSelect.value || 'all';
        });

        dateRangeSelect.addEventListener('change', () => {
            if (dateRangeSelect.value === 'custom') {
                openCustomDateModal();
                return;
            }
            previousDateRange = dateRangeSelect.value || 'all';
            appliedCustomRange = false;
            updateCustomDateLabel();
        });

        cancelButtons.forEach((button) => {
            if (button.dataset.customDateCancelBound === 'true') return;
            button.dataset.customDateCancelBound = 'true';
            button.addEventListener('click', () => {
                restorePreviousDateRange();
                closeCustomDateModal();
                dateRangeSelect.focus();
            });
        });

        if (applyButton && applyButton.dataset.customDateApplyBound !== 'true') {
            applyButton.dataset.customDateApplyBound = 'true';
            applyButton.addEventListener('click', () => {
                appliedCustomRange = true;
                previousDateRange = 'custom';
                dateRangeSelect.value = 'custom';
                updateCustomDateLabel();
                closeCustomDateModal();
                dateRangeSelect.focus();
            });
        }

        customDateModal.addEventListener('click', (event) => {
            if (event.target === customDateModal) {
                restorePreviousDateRange();
                closeCustomDateModal();
            }
        });

        if (customDateModal.dataset.escapeBound !== 'true') {
            customDateModal.dataset.escapeBound = 'true';
            customDateModal.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape' || customDateModal.hidden) return;
                restorePreviousDateRange();
                closeCustomDateModal();
            });
        }
    }

    function updateEmployeeTableVisibleEdges(root = document) {
        const table = root.querySelector?.('.settings-employee-table');
        if (!table) return;

        table.querySelectorAll('tbody tr').forEach((row) => {
            row.classList.remove('is-last-visible-row');
        });

        const visibleRows = Array.from(table.querySelectorAll('tbody tr')).filter((row) => !row.hidden);
        const lastVisibleRow = visibleRows[visibleRows.length - 1];
        if (lastVisibleRow) {
            lastVisibleRow.classList.add('is-last-visible-row');
        }
    }

    function submitFormWithButton(form, button) {
        if (!form) return;
        if (typeof form.requestSubmit === 'function') {
            if (button) form.requestSubmit(button);
            else form.requestSubmit();
            return;
        }

        let fallbackInput = null;
        if (button?.name) {
            fallbackInput = document.createElement('input');
            fallbackInput.type = 'hidden';
            fallbackInput.name = button.name;
            fallbackInput.value = button.value || '';
            form.appendChild(fallbackInput);
        }
        form.submit();
        fallbackInput?.remove();
    }

    function initializeTeamAccessPage(root = document) {
        updateEmployeeTableVisibleEdges(root);

        const roleSelects = root.querySelectorAll('[data-employee-role-select]');

        roleSelects.forEach((select) => {
            if (select.dataset.roleChangeBound === 'true') return;
            select.dataset.roleChangeBound = 'true';

            select.addEventListener('change', async () => {
                if (select.dataset.roleChangeBypass === 'true') return;

                const form = select.closest('[data-employee-role-form]');
                const employeeName = form?.dataset.employeeName || 'this employee';
                const oldRole = select.dataset.originalRole || '';
                const newRole = select.value;

                if (!newRole || newRole === oldRole) return;

                const confirmed = await showStockWiseConfirm({
                    title: 'Change employee role?',
                    message: `Are you sure you want to change ${employeeName}'s role from ${oldRole} to ${newRole}?`,
                    confirmLabel: 'Change Role',
                });

                if (!confirmed) {
                    select.dataset.roleChangeBypass = 'true';
                    select.value = oldRole;
                    refreshEnhancedSelect(select);
                    window.setTimeout(() => {
                        delete select.dataset.roleChangeBypass;
                    }, 0);
                    return;
                }

                submitFormWithButton(form);
            });
        });

        const confirmButtons = root.querySelectorAll('[data-confirm-message]');

        confirmButtons.forEach((button) => {
            if (button.dataset.confirmBound === 'true') return;
            button.dataset.confirmBound = 'true';

            button.addEventListener('click', async (event) => {
                const message = button.dataset.confirmMessage;
                if (!message || button.disabled || button.dataset.confirmBypassed === 'true') return;

                event.preventDefault();

                const confirmed = await showStockWiseConfirm({
                    title: 'Confirm action',
                    message,
                    confirmLabel: button.textContent.trim() || 'Continue',
                    danger: button.classList.contains('danger') || button.value === 'removed',
                });

                if (!confirmed) return;

                button.dataset.confirmBypassed = 'true';
                submitFormWithButton(button.closest('form'), button);
                window.setTimeout(() => {
                    delete button.dataset.confirmBypassed;
                }, 0);
            });
        });

        const toggleRemovedButton = root.querySelector('[data-toggle-removed-employees]');
        const removedRows = root.querySelectorAll('[data-removed-employee-row]');
        const tableWrap = root.querySelector('.settings-employee-table-wrap');

        if (toggleRemovedButton && toggleRemovedButton.dataset.removedToggleBound !== 'true') {
            toggleRemovedButton.dataset.removedToggleBound = 'true';
            toggleRemovedButton.addEventListener('click', () => {
                const showingRemoved = toggleRemovedButton.getAttribute('aria-expanded') === 'true';
                const nextState = !showingRemoved;
                tableWrap?.classList.add('is-switching');

                window.setTimeout(() => {
                    removedRows.forEach((row) => {
                        row.hidden = !nextState;
                    });
                    toggleRemovedButton.setAttribute('aria-expanded', String(nextState));
                    toggleRemovedButton.textContent = nextState ? 'Hide removed employees' : 'Show removed employees';
                    updateEmployeeTableVisibleEdges(root);
                    tableWrap?.classList.remove('is-switching');
                }, 120);
            });
        }
    }

    function preventBrowserFileDropNavigation(root = document) {
        if (document.body.dataset.fileDropNavigationGuard === 'true') return;
        document.body.dataset.fileDropNavigationGuard = 'true';
        ['dragover', 'drop'].forEach((eventName) => {
            document.addEventListener(eventName, (event) => {
                const insideDropzone = event.target?.closest?.('#dropzone, [data-onboarding-upload-form]');
                const types = event.dataTransfer?.types;
                const hasFiles = types ? (Array.from(types).includes('Files') || types.contains?.('Files')) : false;
                if (!insideDropzone && hasFiles) {
                    event.preventDefault();
                }
            });
        });
    }

    function initializePage(root = document) {
        preventBrowserFileDropNavigation(root);
        clearStaleInteractionBlockers(root);
        const pageRoot = root.id === "page-content" ? root : (root.querySelector?.("#page-content") || root);

        if (document.body.classList.contains("auth-body") || pageRoot.querySelector?.("#authFormStage")) {
            initializeAuthPage(document);
            return;
        }

        const pageKey = getCurrentPageKey(pageRoot);

        initializeTopbarDropdowns(document);
        initializeLogoutConfirmation(document);
        initializeHelpTips(pageRoot);
        initializeStockWiseToasts(document);
        initializePasswordToggles(pageRoot);
        initializeEnhancedSelects(pageRoot);

        if (pageKey === "dashboard") {
            initializeCharts(pageRoot);
            return;
        }

        if (pageKey === "upload_data") {
            initializeUploadInteractions(pageRoot);
            return;
        }

        if (pageKey === "insights") {
            initializeInsightsTabs(pageRoot);
            initializeInsightsForecast(pageRoot);
            return;
        }

        if (pageKey === "products") {
            initializeFilters(pageRoot);
            initializeProductDetails(pageRoot);
            return;
        }

        if (pageKey === "reports") {
            initializeCharts(pageRoot);
            initializeFilters(pageRoot);
            initializeReportFilterDrawer(pageRoot);
            initializeReportExport(pageRoot);
            return;
        }

        if (pageKey === "settings") {
            initializeSettingsPage(pageRoot);
            initializeTeamAccessPage(pageRoot);
            initializeActivityLogsPage(pageRoot);
            return;
        }

        if (pageKey === "first_time_setup") {
            initializeOnboardingPage(pageRoot);
            return;
        }

        initializeCharts(pageRoot);
        initializeUploadInteractions(pageRoot);
        initializeFilters(pageRoot);
        initializeReportFilterDrawer(pageRoot);
        initializeReportExport(pageRoot);
        initializeInsightsTabs(pageRoot);
        initializeInsightsForecast(pageRoot);
        initializeProductDetails(pageRoot);
        initializeSettingsPage(pageRoot);
        initializeTeamAccessPage(pageRoot);
        initializeActivityLogsPage(pageRoot);
        initializeOnboardingPage(pageRoot);
        initializeAuthPage(root);
    }


    document.addEventListener('click', (event) => {
        if (!event.target.closest('.help-tip') && !event.target.closest('.help-popover') && !event.target.closest('.help-modal-card')) {
            closeHelpSurfaces();
        }
    });

    window.addEventListener('resize', closeHelpSurfaces);
    window.addEventListener('scroll', closeHelpSurfaces, true);

    window.addEventListener("pageshow", (event) => {
        setProcessingOverlayVisible(document, false);
        clearStaleInteractionBlockers(document);
        initializePage(document.getElementById("page-content") || document);
        if (event.persisted) {
            playPageEnterTransition(document.getElementById("page-content"));
        }
    });

    document.addEventListener("DOMContentLoaded", () => {
        setProcessingOverlayVisible(document, false);
        clearStaleInteractionBlockers(document);
        syncActiveNav(window.location.href);
        setupPersistentNavigation(document);
        initializePage(document.getElementById("page-content") || document);
        playPageEnterTransition(document.getElementById("page-content"));
    });
})();
