const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminEnableUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  AdminListGroupsForUserCommand
} = require('@aws-sdk/client-cognito-identity-provider');
const { response } = require('./helpers/utils');

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || 'us-east-1_plBqP2xqJ';

// Helper function to check if user is admin
async function isUserAdmin(username, tokenPayload = null) {
  try {
    // First, check if groups are in the JWT token directly
    if (tokenPayload && tokenPayload['cognito:groups']) {
      const groups = tokenPayload['cognito:groups'];
      console.log('Groups from token:', groups);
      const isAdmin = Array.isArray(groups) && groups.includes('admin');
      console.log('User is admin (from token):', isAdmin);
      return isAdmin;
    }

    // Fallback: Query Cognito for user groups (only if USER_POOL_ID is properly configured)
    if (!USER_POOL_ID || USER_POOL_ID === 'UserPool') {
      console.error('USER_POOL_ID not properly configured:', USER_POOL_ID);
      return false;
    }

    console.log('Checking groups via Cognito API for username:', username);
    const command = new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    });
    const response = await cognitoClient.send(command);
    console.log('Cognito groups response:', response.Groups);
    const isAdmin = response.Groups?.some(group => group.GroupName === 'admin') || false;
    console.log('User is admin (from API):', isAdmin);
    return isAdmin;
  } catch (error) {
    console.error('Could not check user admin status:', error);
    return false;
  }
}

// Helper function to get username and token payload from JWT token
function getUserInfoFromEvent(event) {
  try {
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('No valid authorization header found');
      return { username: null, payload: null };
    }

    const token = authHeader.substring(7);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    console.log('JWT payload:', JSON.stringify(payload, null, 2));

    // Try different username fields in order of preference
    const username = payload['cognito:username'] ||
                    payload.username ||
                    payload.sub ||
                    payload.email;

    console.log('Extracted username:', username);
    return { username, payload };
  } catch (error) {
    console.error('Could not extract info from token:', error);
    return { username: null, payload: null };
  }
}

// Helper function to format user data
function formatUser(cognitoUser) {
  const getAttributeValue = (attributes, name) => {
    const attr = attributes?.find(a => a.Name === name);
    return attr ? attr.Value : null;
  };

  return {
    userId: cognitoUser.Username,
    email: getAttributeValue(cognitoUser.Attributes, 'email'),
    emailVerified: getAttributeValue(cognitoUser.Attributes, 'email_verified') === 'true',
    status: cognitoUser.UserStatus,
    enabled: cognitoUser.Enabled,
    created: cognitoUser.UserCreateDate,
    lastModified: cognitoUser.UserLastModifiedDate,
    displayStatus: getDisplayStatus(cognitoUser.UserStatus, cognitoUser.Enabled)
  };
}

function getDisplayStatus(userStatus, enabled) {
  if (!enabled) {return 'Inactive';}

  switch (userStatus) {
  case 'FORCE_CHANGE_PASSWORD': return 'Invited';
  case 'CONFIRMED': return 'Active';
  case 'UNCONFIRMED': return 'Pending';
  case 'ARCHIVED': return 'Inactive';
  case 'COMPROMISED': return 'Compromised';
  case 'RESET_REQUIRED': return 'Reset Required';
  default: return userStatus;
  }
}

function parseBody(event) {
  if (!event || !event.body) {return {};}
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return {};
  }
}

exports.handler = async (event, context, callback) => {
  context.callbackWaitsForEmptyEventLoop = false;

  console.log('Event object:', JSON.stringify(event, null, 2));

  const method = event.httpMethod || event.requestContext?.http?.method || 'GET';
  const pathParameters = event.pathParameters || {};
  const body = parseBody(event);

  console.log('Method:', method);
  console.log('Path:', event.path);
  console.log('Resource:', event.resource);
  console.log('Path parameters:', pathParameters);

  try {
    // Check if user is admin
    const userInfo = getUserInfoFromEvent(event);
    if (!userInfo || !userInfo.username) {
      response.statusCode = 401;
      response.body = JSON.stringify({ message: 'Unauthorized - No valid token' });
      return callback(null, response);
    }

    const isAdmin = await isUserAdmin(userInfo.username, userInfo.payload);
    if (!isAdmin) {
      response.statusCode = 403;
      response.body = JSON.stringify({ message: 'Forbidden - Admin access required' });
      return callback(null, response);
    }

    // Route to appropriate handler
    switch (method) {
    case 'GET':
      if (pathParameters.userId) {
        const result = await getUser(pathParameters.userId);
        response.statusCode = result.statusCode;
        response.body = result.body;
        return callback(null, response);
      } else {
        const result = await listUsers();
        response.statusCode = result.statusCode;
        response.body = result.body;
        return callback(null, response);
      }

    case 'POST':
      const path = event.path || event.requestContext?.http?.path || '';
      if (path.includes('/invite')) {
        const result = await inviteUser(body);
        response.statusCode = result.statusCode;
        response.body = result.body;
        return callback(null, response);
      }
      break;

    case 'PUT':
      const userId = pathParameters.userId;
      if (!userId) {
        response.statusCode = 400;
        response.body = JSON.stringify({ message: 'User ID required' });
        return callback(null, response);
      }

      const putPath = event.path || event.requestContext?.http?.path || '';
      if (putPath.includes('/activate')) {
        const result = await activateUser(userId);
        response.statusCode = result.statusCode;
        response.body = result.body;
        return callback(null, response);
      } else if (putPath.includes('/deactivate')) {
        const result = await deactivateUser(userId);
        response.statusCode = result.statusCode;
        response.body = result.body;
        return callback(null, response);
      }
      break;

    case 'DELETE':
      const userIdToDelete = pathParameters.userId;
      if (!userIdToDelete) {
        response.statusCode = 400;
        response.body = JSON.stringify({ message: 'User ID required' });
        return callback(null, response);
      }
      const result = await deleteUser(userIdToDelete);
      response.statusCode = result.statusCode;
      response.body = result.body;
      return callback(null, response);

    default:
      response.statusCode = 405;
      response.body = JSON.stringify({ message: 'Method Not Allowed' });
      return callback(null, response);
    }

    response.statusCode = 404;
    response.body = JSON.stringify({ message: 'Not Found' });
    return callback(null, response);

  } catch (error) {
    console.error('Users handler error:', error);
    response.statusCode = 500;
    response.body = JSON.stringify({
      message: 'Internal server error',
      error: error.message
    });
    return callback(null, response);
  }
};

// List all users
async function listUsers() {
  try {
    const command = new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: 60 // Cognito max per request
    });

    const response = await cognitoClient.send(command);
    const users = response.Users?.map(formatUser) || [];

    return {
      statusCode: 200,
      body: JSON.stringify({ users })
    };
  } catch (error) {
    console.error('List users error:', error);
    throw error;
  }
}

// Get specific user
async function getUser(userId) {
  try {
    const command = new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId
    });

    const response = await cognitoClient.send(command);
    const user = {
      userId: response.Username,
      email: response.UserAttributes?.find(a => a.Name === 'email')?.Value,
      emailVerified: response.UserAttributes?.find(a => a.Name === 'email_verified')?.Value === 'true',
      status: response.UserStatus,
      enabled: response.Enabled,
      created: response.UserCreateDate,
      lastModified: response.UserLastModifiedDate,
      displayStatus: getDisplayStatus(response.UserStatus, response.Enabled)
    };

    return {
      statusCode: 200,

      body: JSON.stringify({ user })
    };
  } catch (error) {
    if (error.name === 'UserNotFoundException') {
      return {
        statusCode: 404,

        body: JSON.stringify({ message: 'User not found' })
      };
    }
    console.error('Get user error:', error);
    throw error;
  }
}

// Invite new user
async function inviteUser(body) {
  const { email } = body;

  if (!email || !email.includes('@')) {
    return {
      statusCode: 400,

      body: JSON.stringify({ message: 'Valid email address required' })
    };
  }

  try {
    const command = new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' }
      ],
      DesiredDeliveryMediums: ['EMAIL'],
      MessageAction: 'SEND' // Send welcome email
    });

    const response = await cognitoClient.send(command);
    const user = formatUser(response.User);

    return {
      statusCode: 201,

      body: JSON.stringify({
        message: 'User invited successfully',
        user
      })
    };
  } catch (error) {
    if (error.name === 'UsernameExistsException') {
      return {
        statusCode: 409,

        body: JSON.stringify({ message: 'User already exists' })
      };
    }
    console.error('Invite user error:', error);
    throw error;
  }
}

// Activate user
async function activateUser(userId) {
  try {
    const command = new AdminEnableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId
    });

    await cognitoClient.send(command);

    return {
      statusCode: 200,

      body: JSON.stringify({ message: 'User activated successfully' })
    };
  } catch (error) {
    if (error.name === 'UserNotFoundException') {
      return {
        statusCode: 404,

        body: JSON.stringify({ message: 'User not found' })
      };
    }
    console.error('Activate user error:', error);
    throw error;
  }
}

// Deactivate user
async function deactivateUser(userId) {
  try {
    const command = new AdminDisableUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId
    });

    await cognitoClient.send(command);

    return {
      statusCode: 200,

      body: JSON.stringify({ message: 'User deactivated successfully' })
    };
  } catch (error) {
    if (error.name === 'UserNotFoundException') {
      return {
        statusCode: 404,

        body: JSON.stringify({ message: 'User not found' })
      };
    }
    console.error('Deactivate user error:', error);
    throw error;
  }
}

// Delete user (hard delete)
async function deleteUser(userId) {
  try {
    const command = new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId
    });

    await cognitoClient.send(command);

    return {
      statusCode: 200,

      body: JSON.stringify({ message: 'User deleted successfully' })
    };
  } catch (error) {
    if (error.name === 'UserNotFoundException') {
      return {
        statusCode: 404,

        body: JSON.stringify({ message: 'User not found' })
      };
    }
    console.error('Delete user error:', error);
    throw error;
  }
}
