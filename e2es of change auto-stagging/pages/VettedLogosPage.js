const BasePage = require('./BasePage');

class VettedLogosPage extends BasePage {
  constructor(page) {
    super(page);
    this.visitorsLink = 'a[href="/vetted-logos/visitors"]';
    this.chatLogsLink = 'a[href="/vetted-logos/chat-logs"]';
    this.analyticsLink = 'a[href="/vetted-logos/analytics"]';
    this.monitorLink = 'a[href="/vetted-logos/monitor"]';
    this.usersLink = 'a[href="/vetted-logos/users"]';
    this.tagsLink = 'a[href="/vetted-logos/tags"]';
    this.cannedResponsesLink = 'a[href="/vetted-logos/canned-responses"]';
    this.widgetSettingsLink = 'a[href="/vetted-logos/widget-settings"]';
    this.rolesLink = 'a[href="/vetted-logos/roles"]';
    this.permissionsLink = 'a[href="/vetted-logos/permissions"]';
    this.triggersLink = 'a[href="/vetted-logos/triggers"]';
    this.departmentsLink = 'a[href="/vetted-logos/departments"]';
    this.bannedVisitorsLink = 'a[href="/vetted-logos/banned-visitors"]';
    this.personalLink = 'a[href="/vetted-logos/personal"]';
  }

  async navigateToVisitors() {
    await this.click(this.visitorsLink);
    await this.waitForLoad();
  }

  async navigateToChatLogs() {
    await this.click(this.chatLogsLink);
    await this.waitForLoad();
  }

  async navigateToAnalytics() {
    await this.click(this.analyticsLink);
    await this.waitForLoad();
  }

  async navigateToMonitor() {
    await this.click(this.monitorLink);
    await this.waitForLoad();
  }

  async navigateToUsers() {
    await this.click(this.usersLink);
    await this.waitForLoad();
  }

  async navigateToTags() {
    await this.click(this.tagsLink);
    await this.waitForLoad();
  }

  async navigateToCannedResponses() {
    await this.click(this.cannedResponsesLink);
    await this.waitForLoad();
  }

  async navigateToWidgetSettings() {
    await this.click(this.widgetSettingsLink);
    await this.waitForLoad();
  }

  async navigateToRoles() {
    await this.click(this.rolesLink);
    await this.waitForLoad();
  }

  async navigateToPermissions() {
    await this.click(this.permissionsLink);
    await this.waitForLoad();
  }

  async navigateToTriggers() {
    await this.click(this.triggersLink);
    await this.waitForLoad();
  }

  async navigateToDepartments() {
    await this.click(this.departmentsLink);
    await this.waitForLoad();
  }

  async navigateToBannedVisitors() {
    await this.click(this.bannedVisitorsLink);
    await this.waitForLoad();
  }

  async navigateToPersonal() {
    await this.click(this.personalLink);
    await this.waitForLoad();
  }
}

module.exports = VettedLogosPage;